import {
  GraphQLBoolean,
  GraphQLFloat,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  type GraphQLFieldConfigArgumentMap,
  type GraphQLFieldConfigMap,
  type GraphQLOutputType,
  type GraphQLResolveInfo,
} from "graphql";
import DataLoader from "dataloader";
import { RudraError } from "@rudra/errors";
import type { GraphQLFieldConfig, GraphQLSchemaConfig, GraphQLTypeConfig } from "../registry.js";
import { executeResolver, type ResolverContext } from "../resolvers/execute.js";

function unwrapTypeName(type: string): { name: string; list: boolean; nonNull: boolean } {
  let current = type.trim();
  let nonNull = false;
  let list = false;
  if (current.endsWith("!")) {
    nonNull = true;
    current = current.slice(0, -1);
  }
  const listMatch = /^\[(.+)\]!?$/.exec(current);
  if (listMatch) {
    list = true;
    current = listMatch[1]!;
    if (current.endsWith("!")) current = current.slice(0, -1);
  }
  return { name: current, list, nonNull };
}

function scalar(name: string): GraphQLOutputType | null {
  switch (name) {
    case "String":
      return GraphQLString;
    case "Int":
      return GraphQLInt;
    case "Float":
      return GraphQLFloat;
    case "Boolean":
      return GraphQLBoolean;
    case "ID":
      return GraphQLID;
    default:
      return null;
  }
}

function estimateComplexity(info: GraphQLResolveInfo): number {
  return info.fieldNodes.reduce((sum, node) => sum + (node.selectionSet?.selections.length ?? 1), 0);
}

function depthOf(info: GraphQLResolveInfo): number {
  let depth = 0;
  let path: typeof info.path | undefined = info.path;
  while (path) {
    depth += 1;
    path = path.prev;
  }
  return depth;
}

export function buildExecutableSchema(
  config: GraphQLSchemaConfig,
  _ctxFactory: () => ResolverContext,
): GraphQLSchema {
  const typeMap = new Map<string, GraphQLObjectType>();

  const resolveOutputType = (typeName: string): GraphQLOutputType => {
    const parsed = unwrapTypeName(typeName);
    let base: GraphQLOutputType | null = scalar(parsed.name);
    if (!base) {
      const existing = typeMap.get(parsed.name);
      if (!existing) {
        throw new RudraError("VALIDATION_ERROR", `Unknown GraphQL type: ${parsed.name}`);
      }
      base = existing;
    }
    let out: GraphQLOutputType = base;
    if (parsed.list) out = new GraphQLList(out);
    if (parsed.nonNull) out = new GraphQLNonNull(out as never);
    return out;
  };

  for (const typeConfig of (config.types ?? []).filter((t: GraphQLTypeConfig) => t.kind !== "input")) {
    typeMap.set(
      typeConfig.name,
      new GraphQLObjectType({
        name: typeConfig.name,
        fields: () => buildFields(typeConfig, resolveOutputType, config),
      }),
    );
  }

  const queryFields: GraphQLFieldConfigMap<unknown, ResolverContext> = {};
  for (const field of config.queries ?? []) {
    queryFields[field.name] = buildField(field, resolveOutputType, config);
  }
  if (Object.keys(queryFields).length === 0) {
    queryFields.health = {
      type: GraphQLString,
      resolve: () => "ok",
    };
  }

  const mutationFields: GraphQLFieldConfigMap<unknown, ResolverContext> = {};
  for (const field of config.mutations ?? []) {
    mutationFields[field.name] = buildField(field, resolveOutputType, config);
  }

  return new GraphQLSchema({
    query: new GraphQLObjectType({
      name: "Query",
      fields: queryFields,
    }),
    mutation:
      Object.keys(mutationFields).length > 0
        ? new GraphQLObjectType({
            name: "Mutation",
            fields: mutationFields,
          })
        : undefined,
  });
}

function buildFields(
  typeConfig: GraphQLTypeConfig,
  resolveOutputType: (typeName: string) => GraphQLOutputType,
  schemaConfig: GraphQLSchemaConfig,
): GraphQLFieldConfigMap<unknown, ResolverContext> {
  const fields: GraphQLFieldConfigMap<unknown, ResolverContext> = {};
  for (const field of typeConfig.fields) {
    fields[field.name] = buildField(field, resolveOutputType, schemaConfig);
  }
  return fields;
}

function buildField(
  field: GraphQLFieldConfig,
  resolveOutputType: (typeName: string) => GraphQLOutputType,
  schemaConfig: GraphQLSchemaConfig,
) {
  const args: GraphQLFieldConfigArgumentMap = {};
  for (const arg of field.args ?? []) {
    args[arg.name] = { type: resolveOutputType(arg.type) as never };
  }

  return {
    type: resolveOutputType(field.type),
    args,
    resolve: async (
      parent: unknown,
      resolveArgs: Record<string, unknown>,
      context: ResolverContext,
      info: GraphQLResolveInfo,
    ) => {
      if (depthOf(info) > (schemaConfig.queryDepthLimit ?? 10)) {
        throw new RudraError("VALIDATION_ERROR", "Query depth limit exceeded");
      }
      context.complexity = (context.complexity ?? 0) + estimateComplexity(info);
      if (context.complexity > (schemaConfig.queryComplexityLimit ?? 1000)) {
        throw new RudraError("VALIDATION_ERROR", "Query complexity limit exceeded");
      }

      const resolver = field.resolver ?? { type: "parent" as const, field: field.name };
      return executeResolver(resolver, {
        parent,
        args: resolveArgs,
        context,
        info,
        fieldName: field.name,
      });
    },
  };
}

export function createRequestContext(
  base: Omit<ResolverContext, "loaders" | "complexity">,
): ResolverContext {
  return {
    ...base,
    complexity: 0,
    loaders: new Map<string, DataLoader<string, unknown>>(),
  };
}
