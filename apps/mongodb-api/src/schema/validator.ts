import { RudraError } from "@rudra/errors";
import type { MongoSchemaNode } from "../types.js";

const BSON_TYPE_MAP: Record<MongoSchemaNode["type"], string | string[]> = {
  string: "string",
  boolean: "bool",
  int: "int",
  long: "long",
  double: "double",
  decimal: "decimal",
  date: "date",
  timestamp: "timestamp",
  objectId: "objectId",
  array: "array",
  object: "object",
  binary: "binData",
  null: "null",
};

export function rudraSchemaToJsonSchema(
  schema: Record<string, MongoSchemaNode>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    _id: { bsonType: "objectId" },
  };
  const required: string[] = [];

  for (const [name, node] of Object.entries(schema)) {
    properties[name] = nodeToJsonSchema(node);
    if (node.required) required.push(name);
  }

  return {
    bsonType: "object",
    required: required.length ? required : undefined,
    properties,
    additionalProperties: false,
  };
}

function nodeToJsonSchema(node: MongoSchemaNode): Record<string, unknown> {
  const bsonType = BSON_TYPE_MAP[node.type];
  if (!bsonType) {
    throw new RudraError("VALIDATION_ERROR", `Unsupported Mongo type: ${node.type}`);
  }

  if (node.type === "object") {
    const nested = node.properties ?? {};
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, child] of Object.entries(nested)) {
      properties[key] = nodeToJsonSchema(child);
      if (child.required) required.push(key);
    }
    return {
      bsonType: "object",
      properties,
      required: required.length ? required : undefined,
      additionalProperties: false,
    };
  }

  if (node.type === "array") {
    if (!node.items) {
      throw new RudraError("VALIDATION_ERROR", "array type requires items");
    }
    return {
      bsonType: "array",
      items: nodeToJsonSchema(node.items),
    };
  }

  return { bsonType };
}
