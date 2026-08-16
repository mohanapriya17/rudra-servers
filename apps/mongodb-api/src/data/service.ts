import type { Db, Document } from "mongodb";
import {
  parseObjectId,
  toPublicDoc,
  translateAggregateStages,
  translateProjection,
  translateSort,
  translateWhere,
} from "@rudra/mongodb-driver";
import { RudraError } from "@rudra/errors";
import type { MongoResourceRecord } from "../types.js";
import { rudraSchemaToJsonSchema } from "../schema/validator.js";
import { coerceDocument } from "./coerce.js";

export async function ensureCollection(db: Db, resource: MongoResourceRecord): Promise<void> {
  const existing = await db.listCollections({ name: resource.physicalCollection }).toArray();
  if (existing.length === 0) {
    if (resource.schema && resource.validationLevel !== "off") {
      await db.createCollection(resource.physicalCollection, {
        validator: { $jsonSchema: rudraSchemaToJsonSchema(resource.schema) },
        validationLevel: resource.validationLevel,
        validationAction: resource.validationAction,
      });
    } else {
      await db.createCollection(resource.physicalCollection);
    }
    return;
  }

  if (resource.schema && resource.validationLevel !== "off") {
    await db.command({
      collMod: resource.physicalCollection,
      validator: { $jsonSchema: rudraSchemaToJsonSchema(resource.schema) },
      validationLevel: resource.validationLevel,
      validationAction: resource.validationAction,
    });
  }
}

export async function createIndex(
  db: Db,
  resource: MongoResourceRecord,
  index: {
    name: string;
    fields: Record<string, 1 | -1 | "text" | "2d" | "2dsphere">;
    unique?: boolean;
    sparse?: boolean;
    expireAfterSeconds?: number;
    partialFilterExpression?: Record<string, unknown>;
  },
): Promise<string> {
  const collection = db.collection(resource.physicalCollection);
  const options: Record<string, unknown> = {
    name: index.name,
    unique: index.unique,
    sparse: index.sparse,
  };
  if (index.expireAfterSeconds != null) {
    options.expireAfterSeconds = index.expireAfterSeconds;
  }
  if (index.partialFilterExpression) {
    options.partialFilterExpression = translateWhere(index.partialFilterExpression);
  }
  return collection.createIndex(index.fields, options);
}

function collection(db: Db, resource: MongoResourceRecord) {
  return db.collection(resource.physicalCollection);
}

export async function listDocuments(
  db: Db,
  resource: MongoResourceRecord,
  options: {
    where?: Record<string, unknown>;
    sort?: Array<{ field: string; direction: "asc" | "desc" }>;
    projection?: string[];
    limit?: number;
    skip?: number;
  },
) {
  const filter = translateWhere(options.where);
  const cursor = collection(db, resource)
    .find(filter)
    .sort(translateSort(options.sort) ?? {})
    .project(translateProjection(options.projection) ?? {})
    .skip(options.skip ?? 0)
    .limit(options.limit ?? 50);

  const docs = await cursor.toArray();
  return docs.map((doc) => toPublicDoc(doc as Record<string, unknown>)!);
}

export async function getDocument(db: Db, resource: MongoResourceRecord, id: string) {
  const doc = await collection(db, resource).findOne({ _id: parseObjectId(id) });
  if (!doc) throw new RudraError("NOT_FOUND", "Document not found");
  return toPublicDoc(doc as Record<string, unknown>)!;
}

export async function createDocument(
  db: Db,
  resource: MongoResourceRecord,
  data: Record<string, unknown>,
) {
  const { id: _idIgnored, _id: __ignored, ...rest } = data;
  const payload = coerceDocument(rest, resource.schema);
  const result = await collection(db, resource).insertOne(payload as Document);
  const doc = await collection(db, resource).findOne({ _id: result.insertedId });
  return toPublicDoc(doc as Record<string, unknown>)!;
}

export async function updateDocument(
  db: Db,
  resource: MongoResourceRecord,
  id: string,
  data: Record<string, unknown>,
) {
  const { id: _i, _id: __i, ...rest } = data;
  const payload = coerceDocument(rest, resource.schema);
  const result = await collection(db, resource).findOneAndUpdate(
    { _id: parseObjectId(id) },
    { $set: payload },
    { returnDocument: "after" },
  );
  if (!result) throw new RudraError("NOT_FOUND", "Document not found");
  return toPublicDoc(result as Record<string, unknown>)!;
}

export async function deleteDocument(db: Db, resource: MongoResourceRecord, id: string) {
  const result = await collection(db, resource).findOneAndDelete({ _id: parseObjectId(id) });
  if (!result) throw new RudraError("NOT_FOUND", "Document not found");
  return toPublicDoc(result as Record<string, unknown>)!;
}

export async function queryDocuments(
  db: Db,
  resource: MongoResourceRecord,
  body: {
    where?: Record<string, unknown>;
    and?: Array<Record<string, unknown>>;
    or?: Array<Record<string, unknown>>;
    sort?: Array<{ field: string; direction: "asc" | "desc" }>;
    projection?: string[];
    limit?: number;
    skip?: number;
  },
) {
  const where: Record<string, unknown> = { ...(body.where ?? {}) };
  if (body.and) where.and = body.and;
  if (body.or) where.or = body.or;
  return listDocuments(db, resource, {
    where,
    sort: body.sort,
    projection: body.projection,
    limit: body.limit ?? 50,
    skip: body.skip ?? 0,
  });
}

export async function aggregateDocuments(
  db: Db,
  resource: MongoResourceRecord,
  stages: Array<{ stage: string; spec?: unknown }>,
) {
  const pipeline = translateAggregateStages(
    stages.map((stage) => ({ stage: stage.stage, spec: stage.spec ?? null })),
  );
  const docs = await collection(db, resource).aggregate(pipeline).toArray();
  return docs.map((doc) => {
    if (doc && typeof doc === "object" && "_id" in doc) {
      return toPublicDoc(doc as Record<string, unknown>)!;
    }
    return doc;
  });
}

export async function bulkCreate(
  db: Db,
  resource: MongoResourceRecord,
  records: Array<Record<string, unknown>>,
) {
  const created = [];
  for (const record of records) {
    created.push(await createDocument(db, resource, record));
  }
  return created;
}

export async function bulkUpdate(
  db: Db,
  resource: MongoResourceRecord,
  records: Array<{ id: string; data: Record<string, unknown> }>,
) {
  const updated = [];
  for (const record of records) {
    updated.push(await updateDocument(db, resource, record.id, record.data));
  }
  return updated;
}

export async function bulkDelete(db: Db, resource: MongoResourceRecord, ids: string[]) {
  const deleted = [];
  for (const id of ids) {
    deleted.push(await deleteDocument(db, resource, id));
  }
  return deleted;
}
