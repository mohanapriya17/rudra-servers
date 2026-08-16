import { ObjectId } from "mongodb";
import type { MongoSchemaNode } from "../types.js";

export function coerceDocument(
  data: Record<string, unknown>,
  schema?: Record<string, MongoSchemaNode>,
): Record<string, unknown> {
  if (!schema) return { ...data };
  const out: Record<string, unknown> = { ...data };
  for (const [key, node] of Object.entries(schema)) {
    if (!(key in out)) continue;
    out[key] = coerceValue(out[key], node);
  }
  return out;
}

function coerceValue(value: unknown, node: MongoSchemaNode): unknown {
  if (value == null) return value;

  switch (node.type) {
    case "objectId":
      if (typeof value === "string" && ObjectId.isValid(value)) return new ObjectId(value);
      return value;
    case "date":
    case "timestamp":
      if (typeof value === "string" || typeof value === "number") return new Date(value);
      return value;
    case "int":
    case "long":
      return typeof value === "string" ? Number.parseInt(value, 10) : value;
    case "double":
    case "decimal":
      return typeof value === "string" ? Number(value) : value;
    case "boolean":
      if (value === "true") return true;
      if (value === "false") return false;
      return value;
    case "object":
      if (value && typeof value === "object" && !Array.isArray(value) && node.properties) {
        return coerceDocument(value as Record<string, unknown>, node.properties);
      }
      return value;
    case "array":
      if (Array.isArray(value) && node.items) {
        return value.map((item) => coerceValue(item, node.items!));
      }
      return value;
    default:
      return value;
  }
}
