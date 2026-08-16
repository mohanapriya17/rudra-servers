import { randomUUID } from "node:crypto";
import { RudraError } from "@rudra/errors";
import { createLogger } from "@rudra/logging";

export interface FunctionDefinition {
  id: string;
  name: string;
  description?: string;
  runtime: "trusted-js";
  code: string;
  timeoutMs: number;
  triggers: string[];
  secrets: string[];
  createdAt: string;
  updatedAt: string;
}

export class FunctionStore {
  private functions = new Map<string, FunctionDefinition>();
  private byName = new Map<string, string>();

  create(input: Omit<FunctionDefinition, "id" | "createdAt" | "updatedAt">): FunctionDefinition {
    if (this.byName.has(input.name)) {
      throw new RudraError("CONFLICT", `Function already exists: ${input.name}`);
    }
    const ts = new Date().toISOString();
    const record: FunctionDefinition = {
      id: randomUUID(),
      ...input,
      createdAt: ts,
      updatedAt: ts,
    };
    this.functions.set(record.id, record);
    this.byName.set(record.name, record.id);
    return record;
  }

  list(): FunctionDefinition[] {
    return [...this.functions.values()];
  }

  get(idOrName: string): FunctionDefinition {
    const byId = this.functions.get(idOrName);
    if (byId) return byId;
    const id = this.byName.get(idOrName);
    if (id) {
      const fn = this.functions.get(id);
      if (fn) return fn;
    }
    throw new RudraError("NOT_FOUND", `Function not found: ${idOrName}`);
  }
}

export interface FunctionContext {
  input: unknown;
  user: { subject: string; roles: string[] } | null;
  env: Record<string, string>;
  secrets: Record<string, string>;
  fetch: typeof fetch;
  postgres: {
    query: (source: string, resource: string, body: Record<string, unknown>) => Promise<unknown>;
  };
  mongodb: {
    query: (source: string, resource: string, body: Record<string, unknown>) => Promise<unknown>;
  };
  files: {
    list: () => Promise<unknown>;
  };
  logger: ReturnType<typeof createLogger>;
}

/**
 * Trusted/admin-created function execution.
 * Not a secure sandbox for hostile user code.
 */
export async function invokeTrustedFunction(
  fn: FunctionDefinition,
  context: FunctionContext,
): Promise<unknown> {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (...args: unknown[]) => Promise<unknown>;

  // Provide a narrow handler surface: module.exports = async (ctx) => {}
  const runner = new AsyncFunction(
    "ctx",
    "exports",
    "module",
    `${fn.code}\n; if (typeof handler === "function") return handler(ctx); if (typeof module.exports === "function") return module.exports(ctx); if (module.exports && typeof module.exports.default === "function") return module.exports.default(ctx); throw new Error("Function must define handler(ctx) or module.exports");`,
  );

  const moduleObj: { exports: unknown } = { exports: {} };
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new RudraError("SERVICE_UNAVAILABLE", "Function timed out")), fn.timeoutMs);
  });

  return Promise.race([runner(context, moduleObj.exports, moduleObj), timeout]);
}

export function buildFunctionContext(options: {
  input: unknown;
  secrets: Record<string, string>;
  postgresApiUrl?: string;
  mongoApiUrl?: string;
  fileApiUrl?: string;
}): FunctionContext {
  const logger = createLogger({ service: "function-api" });
  return {
    input: options.input,
    user: null,
    env: {
      NODE_ENV: process.env.NODE_ENV ?? "development",
    },
    secrets: options.secrets,
    fetch,
    postgres: {
      async query(source, resource, body) {
        if (!options.postgresApiUrl) throw new RudraError("SERVICE_UNAVAILABLE", "Postgres API not configured");
        const res = await fetch(
          `${options.postgresApiUrl.replace(/\/$/, "")}/${encodeURIComponent(source)}/data/${encodeURIComponent(resource)}/query`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        return res.json();
      },
    },
    mongodb: {
      async query(source, resource, body) {
        if (!options.mongoApiUrl) throw new RudraError("SERVICE_UNAVAILABLE", "Mongo API not configured");
        const res = await fetch(
          `${options.mongoApiUrl.replace(/\/$/, "")}/${encodeURIComponent(source)}/data/${encodeURIComponent(resource)}/query`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        return res.json();
      },
    },
    files: {
      async list() {
        if (!options.fileApiUrl) throw new RudraError("SERVICE_UNAVAILABLE", "File API not configured");
        const res = await fetch(`${options.fileApiUrl.replace(/\/$/, "")}`);
        return res.json();
      },
    },
    logger,
  };
}
