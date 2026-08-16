export type MongoSchemaNode = {
  type:
    | "string"
    | "boolean"
    | "int"
    | "long"
    | "double"
    | "decimal"
    | "date"
    | "timestamp"
    | "objectId"
    | "array"
    | "object"
    | "binary"
    | "null";
  required?: boolean;
  items?: MongoSchemaNode;
  properties?: Record<string, MongoSchemaNode>;
};

export interface MongoIndexRecord {
  id: string;
  name: string;
  fields: Record<string, 1 | -1 | "text" | "2d" | "2dsphere">;
  unique: boolean;
  sparse: boolean;
  expireAfterSeconds?: number;
  partialFilterExpression?: Record<string, unknown>;
}

export interface MongoResourceRecord {
  id: string;
  dataSourceId: string;
  name: string;
  physicalCollection: string;
  schema?: Record<string, MongoSchemaNode>;
  validationLevel: "off" | "strict" | "moderate";
  validationAction: "error" | "warn";
  indexes: MongoIndexRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface MongoDataSourceRecord {
  id: string;
  name: string;
  database: string;
  applicationId?: string;
  environmentId?: string;
  connectionSecretId?: string;
  connectionString: string;
  createdAt: string;
  updatedAt: string;
}

export function toPublicDataSource(ds: MongoDataSourceRecord) {
  return {
    id: ds.id,
    name: ds.name,
    database: ds.database,
    applicationId: ds.applicationId ?? null,
    environmentId: ds.environmentId ?? null,
    connectionSecretId: ds.connectionSecretId ?? null,
    configured: true,
    createdAt: ds.createdAt,
    updatedAt: ds.updatedAt,
  };
}
