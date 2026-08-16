import { RudraError } from "@rudra/errors";
import { assertFilterOperator, type FilterOperator } from "@rudra/metadata";
import { ObjectId } from "mongodb";
import { ALLOWED_AGGREGATION_STAGES } from "./client.js";

export {
  createMongoClient,
  pingMongo,
  ALLOWED_AGGREGATION_STAGES,
  assertAllowedAggregationStage,
} from "./client.js";

const FORBIDDEN_KEYS = new Set([
  "$where",
  "$function",
  "$accumulator",
  "$expr",
  "$jsonSchema",
  "$merge",
  "$out",
  "$unionWith",
]);

const FIELD_PATH_RE = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/;

export function assertFieldPath(path: string): string {
  if (!FIELD_PATH_RE.test(path) || path.length > 200) {
    throw new RudraError("VALIDATION_ERROR", `Invalid field path: ${path}`);
  }
  return path;
}

function assertNoForbiddenKeys(value: unknown, depth = 0): void {
  if (depth > 12) {
    throw new RudraError("VALIDATION_ERROR", "Query too deeply nested");
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenKeys(item, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key) || key.startsWith("$")) {
        // Only allow operator keys we explicitly map later; reject raw $-keys from user payloads
        throw new RudraError("VALIDATION_ERROR", `Mongo operator not allowed in input: ${key}`);
      }
      assertNoForbiddenKeys(nested, depth + 1);
    }
  }
}

function coerceValue(value: unknown): unknown {
  if (typeof value === "string" && ObjectId.isValid(value) && value.length === 24) {
    // Only coerce when field path ends with Id or is _id — handled by caller for _id
    return value;
  }
  return value;
}

function operatorToMongo(op: FilterOperator, value: unknown): Record<string, unknown> {
  switch (op) {
    case "eq":
      return { $eq: coerceValue(value) };
    case "neq":
      return { $ne: coerceValue(value) };
    case "gt":
      return { $gt: value };
    case "gte":
      return { $gte: value };
    case "lt":
      return { $lt: value };
    case "lte":
      return { $lte: value };
    case "in":
      if (!Array.isArray(value)) throw new RudraError("VALIDATION_ERROR", "in requires an array");
      return { $in: value.map(coerceValue) };
    case "notIn":
      if (!Array.isArray(value)) throw new RudraError("VALIDATION_ERROR", "notIn requires an array");
      return { $nin: value.map(coerceValue) };
    case "contains":
      return { $regex: escapeRegex(String(value)), $options: "i" };
    case "startsWith":
      return { $regex: `^${escapeRegex(String(value))}`, $options: "i" };
    case "endsWith":
      return { $regex: `${escapeRegex(String(value))}$`, $options: "i" };
    case "isNull":
      return { $eq: null };
    case "notNull":
      return { $ne: null };
    default:
      throw new RudraError("VALIDATION_ERROR", `Unsupported operator: ${op}`);
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function translateWhere(where: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!where || Object.keys(where).length === 0) return {};
  assertNoForbiddenKeys(where);

  const parts: Record<string, unknown>[] = [];

  if (Array.isArray(where.and)) {
    parts.push({ $and: where.and.map((item) => translateWhere(item as Record<string, unknown>)) });
  }
  if (Array.isArray(where.or)) {
    parts.push({ $or: where.or.map((item) => translateWhere(item as Record<string, unknown>)) });
  }

  for (const [key, raw] of Object.entries(where)) {
    if (key === "and" || key === "or") continue;
    const path = assertFieldPath(key);

    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      const entries = Object.entries(raw as Record<string, unknown>);
      const mongoOps: Record<string, unknown> = {};
      for (const [opRaw, value] of entries) {
        const op = assertFilterOperator(opRaw);
        Object.assign(mongoOps, operatorToMongo(op, value));
      }
      if (path === "_id" || path === "id") {
        const target = path === "id" ? "_id" : path;
        if ("$eq" in mongoOps && typeof mongoOps.$eq === "string" && ObjectId.isValid(mongoOps.$eq)) {
          mongoOps.$eq = new ObjectId(mongoOps.$eq);
        }
        parts.push({ [target]: mongoOps });
      } else {
        parts.push({ [path]: mongoOps });
      }
    } else {
      let value = coerceValue(raw);
      if ((path === "_id" || path === "id") && typeof value === "string" && ObjectId.isValid(value)) {
        value = new ObjectId(value);
        parts.push({ _id: value });
      } else if (path === "id") {
        parts.push({ _id: value });
      } else {
        parts.push({ [path]: value });
      }
    }
  }

  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0]!;
  return { $and: parts };
}

export function translateSort(
  sort: Array<{ field: string; direction: "asc" | "desc" }> | undefined,
): Record<string, 1 | -1> | undefined {
  if (!sort?.length) return undefined;
  const out: Record<string, 1 | -1> = {};
  for (const item of sort) {
    const field = item.field === "id" ? "_id" : assertFieldPath(item.field);
    out[field] = item.direction === "desc" ? -1 : 1;
  }
  return out;
}

export function translateProjection(fields: string[] | undefined): Record<string, 0 | 1> | undefined {
  if (!fields?.length) return undefined;
  const out: Record<string, 0 | 1> = {};
  for (const field of fields) {
    const path = field === "id" ? "_id" : assertFieldPath(field);
    out[path] = 1;
  }
  return out;
}

export function translateAggregateStages(
  stages: Array<{ stage: string; spec: unknown }>,
): Record<string, unknown>[] {
  return stages.map((item) => {
    if (!ALLOWED_AGGREGATION_STAGES.has(item.stage)) {
      throw new RudraError("VALIDATION_ERROR", `Aggregation stage not allowed: ${item.stage}`);
    }
    if (item.spec !== null && typeof item.spec === "object") {
      // Block nested forbidden operators in stage specs
      const json = JSON.stringify(item.spec);
      for (const key of FORBIDDEN_KEYS) {
        if (json.includes(`"${key}"`)) {
          throw new RudraError("VALIDATION_ERROR", `Forbidden operator in aggregate: ${key}`);
        }
      }
    }

    if (item.stage === "match") {
      if (!item.spec || typeof item.spec !== "object" || Array.isArray(item.spec)) {
        throw new RudraError("VALIDATION_ERROR", "match stage requires an object spec");
      }
      // Treat match spec as Rudra where clause, not raw Mongo
      return { $match: translateWhere(item.spec as Record<string, unknown>) };
    }

    if (item.stage === "sort") {
      if (!Array.isArray(item.spec)) {
        throw new RudraError("VALIDATION_ERROR", "sort stage requires [{field, direction}]");
      }
      return {
        $sort: translateSort(item.spec as Array<{ field: string; direction: "asc" | "desc" }>),
      };
    }

    if (item.stage === "limit" || item.stage === "skip") {
      const n = Number(item.spec);
      if (!Number.isInteger(n) || n < 0 || n > 10000) {
        throw new RudraError("VALIDATION_ERROR", `${item.stage} must be an integer 0–10000`);
      }
      return { [`$${item.stage}`]: n };
    }

    if (item.stage === "count") {
      const field = typeof item.spec === "string" ? item.spec : "count";
      assertFieldPath(field);
      return { $count: field };
    }

    if (item.stage === "unwind") {
      const path = typeof item.spec === "string" ? item.spec : (item.spec as { path?: string })?.path;
      if (!path || typeof path !== "string") {
        throw new RudraError("VALIDATION_ERROR", "unwind requires a field path");
      }
      const normalized = path.startsWith("$") ? path.slice(1) : path;
      assertFieldPath(normalized);
      return { $unwind: `$${normalized}` };
    }

    if (item.stage === "project" || item.stage === "group" || item.stage === "lookup") {
      if (!item.spec || typeof item.spec !== "object" || Array.isArray(item.spec)) {
        throw new RudraError("VALIDATION_ERROR", `${item.stage} requires an object spec`);
      }
      // Allow only a safe subset of keys for these stages — no JS expressions
      return { [`$${item.stage}`]: sanitizeStageObject(item.spec as Record<string, unknown>) };
    }

    throw new RudraError("VALIDATION_ERROR", `Unhandled stage: ${item.stage}`);
  });
}

function sanitizeStageObject(input: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 8) throw new RudraError("VALIDATION_ERROR", "Stage too deeply nested");
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new RudraError("VALIDATION_ERROR", `Forbidden key: ${key}`);
    }
    // Allow aggregation operators that are not JS execution
    if (key.startsWith("$") && !["$sum", "$avg", "$min", "$max", "$first", "$last", "$push", "$addToSet", "$count", "$size", "$ifNull", "$arrayElemAt", "$map", "$filter"].includes(key) && !key.match(/^\$[a-zA-Z]+$/)) {
      throw new RudraError("VALIDATION_ERROR", `Unsupported stage operator: ${key}`);
    }
    if (key.startsWith("$") && ["$where", "$function", "$accumulator"].includes(key)) {
      throw new RudraError("VALIDATION_ERROR", `Forbidden stage operator: ${key}`);
    }
    if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? sanitizeStageObject(item as Record<string, unknown>, depth + 1)
          : item,
      );
    } else if (value && typeof value === "object") {
      out[key] = sanitizeStageObject(value as Record<string, unknown>, depth + 1);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function toPublicDoc(doc: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return {
    id: _id != null ? String(_id) : undefined,
    ...rest,
  };
}

export function parseObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw new RudraError("VALIDATION_ERROR", `Invalid id: ${id}`);
  }
  return new ObjectId(id);
}
