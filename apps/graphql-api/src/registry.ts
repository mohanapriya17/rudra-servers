import { randomUUID } from "node:crypto";
import { RudraError } from "@rudra/errors";
import {
  graphqlCreateSchemaSchema,
  graphqlFieldSchema,
  graphqlTypeSchema,
} from "@rudra/contracts";
import type { z } from "zod";

export type GraphQLFieldConfig = z.infer<typeof graphqlFieldSchema>;
export type GraphQLTypeConfig = z.infer<typeof graphqlTypeSchema>;
export type GraphQLSchemaConfig = z.infer<typeof graphqlCreateSchemaSchema> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export class GraphQLRegistry {
  private schemas = new Map<string, GraphQLSchemaConfig>();

  create(input: z.infer<typeof graphqlCreateSchemaSchema>): GraphQLSchemaConfig {
    if ([...this.schemas.values()].some((schema) => schema.name === input.name)) {
      throw new RudraError("CONFLICT", `Schema already exists: ${input.name}`);
    }
    const ts = new Date().toISOString();
    const record: GraphQLSchemaConfig = {
      id: randomUUID(),
      name: input.name,
      introspection: input.introspection ?? true,
      queryDepthLimit: input.queryDepthLimit ?? 10,
      queryComplexityLimit: input.queryComplexityLimit ?? 1000,
      types: input.types ?? [],
      queries: input.queries ?? [],
      mutations: input.mutations ?? [],
      createdAt: ts,
      updatedAt: ts,
    };
    this.schemas.set(record.id, record);
    return record;
  }

  list(): GraphQLSchemaConfig[] {
    return [...this.schemas.values()];
  }

  get(idOrName: string): GraphQLSchemaConfig {
    const byId = this.schemas.get(idOrName);
    if (byId) return byId;
    const byName = [...this.schemas.values()].find((schema) => schema.name === idOrName);
    if (byName) return byName;
    throw new RudraError("NOT_FOUND", `GraphQL schema not found: ${idOrName}`);
  }

  addType(schemaId: string, type: GraphQLTypeConfig): GraphQLSchemaConfig {
    const schema = this.get(schemaId);
    if (schema.types!.some((item) => item.name === type.name)) {
      throw new RudraError("CONFLICT", `Type already exists: ${type.name}`);
    }
    schema.types = [...(schema.types ?? []), type];
    schema.updatedAt = new Date().toISOString();
    return schema;
  }

  setQueries(schemaId: string, queries: GraphQLFieldConfig[]): GraphQLSchemaConfig {
    const schema = this.get(schemaId);
    schema.queries = queries;
    schema.updatedAt = new Date().toISOString();
    return schema;
  }

  setMutations(schemaId: string, mutations: GraphQLFieldConfig[]): GraphQLSchemaConfig {
    const schema = this.get(schemaId);
    schema.mutations = mutations;
    schema.updatedAt = new Date().toISOString();
    return schema;
  }
}
