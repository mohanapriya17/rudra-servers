import type { GraphQLResolveInfo } from "graphql";
import DataLoader from "dataloader";
import { RudraError } from "@rudra/errors";
import type { GraphQLFieldConfig } from "../registry.js";

export interface ResolverContext {
  requestId: string;
  postgresEndpoints: Map<string, string>;
  mongoEndpoints: Map<string, string>;
  functionEndpoint?: string;
  allowedRestHosts: Set<string>;
  fetchImpl: typeof fetch;
  loaders: Map<string, DataLoader<string, unknown>>;
  complexity?: number;
  secrets?: Record<string, string>;
}

type ResolverConfig = NonNullable<GraphQLFieldConfig["resolver"]>;

function readPath(source: unknown, path: string): unknown {
  if (!path.startsWith("$")) return path;
  const [, root, ...rest] = path.split(".");
  let current: unknown =
    root === "$args"
      ? undefined
      : root === "$parent"
        ? source
        : root === "$"
          ? source
          : undefined;
  // Support $args.foo and $parent.foo
  if (path.startsWith("$args.")) {
    return undefined; // filled by caller
  }
  if (path.startsWith("$parent.")) {
    current = source;
    for (const key of path.slice("$parent.".length).split(".")) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[key];
    }
    return current;
  }
  for (const key of rest) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function mapArgs(
  mapping: Record<string, string> | undefined,
  parent: unknown,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!mapping) return { ...args };
  const out: Record<string, unknown> = {};
  for (const [key, expr] of Object.entries(mapping)) {
    if (expr.startsWith("$args.")) {
      out[key] = args[expr.slice("$args.".length)];
    } else if (expr.startsWith("$parent.")) {
      out[key] = readPath(parent, expr);
    } else {
      out[key] = expr;
    }
  }
  return out;
}

function assertSafeRestUrl(url: string, allowedHosts: Set<string>): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RudraError("VALIDATION_ERROR", "Invalid REST URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new RudraError("VALIDATION_ERROR", "REST URL protocol not allowed");
  }
  // SSRF protection: block localhost/private IPs unless explicitly allowed
  const host = parsed.hostname;
  const isPrivate =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host === "::1";
  if (isPrivate && !allowedHosts.has(host) && !allowedHosts.has("*")) {
    throw new RudraError("FORBIDDEN", "REST destination blocked by SSRF policy");
  }
  if (allowedHosts.size > 0 && !allowedHosts.has("*") && !allowedHosts.has(host)) {
    throw new RudraError("FORBIDDEN", `REST host not allowlisted: ${host}`);
  }
  return parsed;
}

async function callDataApi(
  baseUrl: string,
  resource: string,
  operation: string,
  args: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const root = baseUrl.replace(/\/$/, "");
  if (operation === "findMany") {
    const res = await fetchImpl(`${root}/data/${encodeURIComponent(resource)}/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        where: (args.where as Record<string, unknown>) ?? args,
        limit: args.limit ?? 50,
      }),
    });
    const body = (await res.json()) as { data?: unknown; error?: unknown };
    if (!res.ok) throw new RudraError("BAD_REQUEST", "Upstream data API error", { details: body });
    return body.data;
  }
  if (operation === "findOne") {
    const id = String(args.id ?? args._id ?? "");
    const res = await fetchImpl(`${root}/data/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`);
    const body = (await res.json()) as { data?: unknown };
    if (!res.ok) throw new RudraError("NOT_FOUND", "Record not found");
    return body.data;
  }
  if (operation === "create") {
    const res = await fetchImpl(`${root}/data/${encodeURIComponent(resource)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args.input ?? args),
    });
    const body = (await res.json()) as { data?: unknown };
    if (!res.ok) throw new RudraError("BAD_REQUEST", "Create failed", { details: body });
    return body.data;
  }
  if (operation === "update") {
    const id = String(args.id ?? "");
    const res = await fetchImpl(`${root}/data/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args.input ?? args.data ?? {}),
    });
    const body = (await res.json()) as { data?: unknown };
    if (!res.ok) throw new RudraError("BAD_REQUEST", "Update failed", { details: body });
    return body.data;
  }
  if (operation === "delete") {
    const id = String(args.id ?? "");
    const res = await fetchImpl(`${root}/data/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const body = (await res.json()) as { data?: unknown };
    if (!res.ok) throw new RudraError("BAD_REQUEST", "Delete failed", { details: body });
    return body.data;
  }
  throw new RudraError("UNSUPPORTED_OPERATION", `Unsupported operation: ${operation}`);
}

export async function executeResolver(
  resolver: ResolverConfig,
  params: {
    parent: unknown;
    args: Record<string, unknown>;
    context: ResolverContext;
    info: GraphQLResolveInfo;
    fieldName: string;
  },
): Promise<unknown> {
  const { parent, args, context } = params;

  switch (resolver.type) {
    case "static":
      return resolver.value;
    case "parent": {
      if (parent && typeof parent === "object") {
        return (parent as Record<string, unknown>)[resolver.field];
      }
      return undefined;
    }
    case "postgres": {
      const endpoint = context.postgresEndpoints.get(resolver.dataSourceId);
      if (!endpoint) {
        throw new RudraError(
          "DATASOURCE_NOT_FOUND",
          `Postgres endpoint not configured for ${resolver.dataSourceId}`,
        );
      }
      const mapped = mapArgs(resolver.mapping, parent, args);
      const loaderKey = `pg:${resolver.dataSourceId}:${resolver.resource}:${resolver.operation}`;
      if (resolver.operation === "findOne") {
        let loader = context.loaders.get(loaderKey);
        if (!loader) {
          loader = new DataLoader(async (ids) => {
            const results = await Promise.all(
              ids.map((id) =>
                callDataApi(endpoint, resolver.resource, "findOne", { id }, context.fetchImpl),
              ),
            );
            return results;
          });
          context.loaders.set(loaderKey, loader);
        }
        const id = String(mapped[resolver.idArg ?? "id"] ?? args.id ?? "");
        return loader.load(id);
      }
      return callDataApi(endpoint, resolver.resource, resolver.operation, mapped, context.fetchImpl);
    }
    case "mongodb": {
      const endpoint = context.mongoEndpoints.get(resolver.dataSourceId);
      if (!endpoint) {
        throw new RudraError(
          "DATASOURCE_NOT_FOUND",
          `Mongo endpoint not configured for ${resolver.dataSourceId}`,
        );
      }
      const mapped = mapArgs(resolver.mapping, parent, args);
      return callDataApi(endpoint, resolver.resource, resolver.operation, mapped, context.fetchImpl);
    }
    case "rest": {
      let url = resolver.url;
      const paramsMap = resolver.params ?? {};
      for (const [key, expr] of Object.entries(paramsMap)) {
        const value =
          expr.startsWith("$parent.")
            ? String(readPath(parent, expr) ?? "")
            : expr.startsWith("$args.")
              ? String(args[expr.slice("$args.".length)] ?? "")
              : expr;
        url = url.replace(`{${key}}`, encodeURIComponent(value));
      }
      const parsed = assertSafeRestUrl(url, context.allowedRestHosts);
      const res = await context.fetchImpl(parsed.toString(), {
        method: resolver.method,
        headers: resolver.headers,
        body: resolver.body != null ? JSON.stringify(resolver.body) : undefined,
      });
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) return res.json();
      return res.text();
    }
    case "function": {
      if (!context.functionEndpoint) {
        throw new RudraError("SERVICE_UNAVAILABLE", "Function endpoint not configured");
      }
      const res = await context.fetchImpl(
        `${context.functionEndpoint.replace(/\/$/, "")}/api/v1/functions/${encodeURIComponent(resolver.functionId)}/invoke`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: args }),
        },
      );
      const body = (await res.json()) as { data?: unknown };
      if (!res.ok) throw new RudraError("BAD_REQUEST", "Function invoke failed", { details: body });
      return body.data;
    }
    default:
      throw new RudraError("UNSUPPORTED_OPERATION", "Unknown resolver type");
  }
}
