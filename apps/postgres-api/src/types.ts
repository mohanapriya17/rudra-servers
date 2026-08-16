export interface PostgresFieldRecord {
  id: string;
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  defaultValue: unknown;
  length?: number;
  precision?: number;
  scale?: number;
  array?: boolean;
  check?: string;
}

export interface PostgresIndexRecord {
  id: string;
  name: string;
  type: "btree" | "hash" | "gin" | "gist" | "brin";
  fields: string[];
  unique: boolean;
}

export interface PostgresRelationRecord {
  id: string;
  field: string;
  referencesResource: string;
  referencesField: string;
  onDelete: string;
  onUpdate: string;
}

export interface PostgresResourceRecord {
  id: string;
  dataSourceId: string;
  name: string;
  physicalSchema: string;
  physicalTable: string;
  fields: PostgresFieldRecord[];
  indexes: PostgresIndexRecord[];
  relations: PostgresRelationRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface PostgresDataSourceRecord {
  id: string;
  name: string;
  ssl: boolean;
  applicationId?: string;
  environmentId?: string;
  connectionSecretId?: string;
  /** Never expose over HTTP. */
  connectionString: string;
  createdAt: string;
  updatedAt: string;
}

export function toPublicDataSource(ds: PostgresDataSourceRecord) {
  return {
    id: ds.id,
    name: ds.name,
    ssl: ds.ssl,
    applicationId: ds.applicationId ?? null,
    environmentId: ds.environmentId ?? null,
    connectionSecretId: ds.connectionSecretId ?? null,
    configured: true,
    createdAt: ds.createdAt,
    updatedAt: ds.updatedAt,
  };
}
