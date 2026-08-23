import { createHash } from "node:crypto";
import {
  ActionInvokeRequestSchema,
  type ActionInvokeRequest,
  type CompiledActionConfig,
} from "@rudra/ai-contracts";
import { RudraError } from "@rudra/errors";
import type { SessionClaims } from "../auth/session.js";

const SQL_PATTERN =
  /\b(select|insert|update|delete|drop|alter|create|truncate|union|grant|revoke)\b[\s\S]*\b(from|into|table|database|where)\b/i;

export interface ActionInvokeContext {
  session: SessionClaims;
  routeId?: string;
  environmentId: string;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface ActionRegistry {
  invoke(actionId: string, request: ActionInvokeRequest, context: ActionInvokeContext): Promise<unknown>;
  list(): string[];
}

function redactValue(value: unknown, fields: string[]): unknown {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, fields));
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = fields.includes(key) ? "[REDACTED]" : redactValue(nested, fields);
  }
  return out;
}

function assertNoSql(input: Record<string, unknown>): void {
  for (const value of Object.values(input)) {
    if (typeof value === "string" && SQL_PATTERN.test(value)) {
      throw new RudraError("VALIDATION_ERROR", "Raw SQL is not allowed in action input");
    }
    if (value && typeof value === "object") {
      assertNoSql(value as Record<string, unknown>);
    }
  }
}

export function createActionRegistry(actions: CompiledActionConfig[]): ActionRegistry {
  const byId = new Map(actions.map((action) => [action.actionId, action]));
  const idempotencyCache = new Map<string, unknown>();

  return {
    list() {
      return [...byId.keys()];
    },

    async invoke(actionId: string, request: ActionInvokeRequest, context: ActionInvokeContext) {
      const parsed = ActionInvokeRequestSchema.parse(request);
      const config = byId.get(actionId);
      if (!config || !config.enabled) {
        throw new RudraError("NOT_FOUND", "Action not found");
      }
      if (config.auth.requireAuthenticated && !context.session.sub) {
        throw new RudraError("UNAUTHORIZED", "Authentication required");
      }
      if (
        !config.allowedEnvironments.includes("*") &&
        !config.allowedEnvironments.includes(context.environmentId)
      ) {
        throw new RudraError("FORBIDDEN", "Action not allowed in this environment");
      }
      if (context.routeId && !config.allowedRoutes.includes("*") && !config.allowedRoutes.includes(context.routeId)) {
        throw new RudraError("FORBIDDEN", "Action not allowed on this route");
      }
      if (config.queryKind !== "parameterized" && config.queryKind !== "repository") {
        throw new RudraError("VALIDATION_ERROR", "Unsupported query kind");
      }
      assertNoSql(parsed.input);
      if (!config.readOnly && config.requiresConfirmation && parsed.confirmed !== true) {
        throw new RudraError("VALIDATION_ERROR", "Write actions require confirmation", {
          details: { actionId, requiresConfirmation: true },
        });
      }

      const cacheKey = parsed.idempotencyKey
        ? createHash("sha256")
            .update(`${actionId}:${parsed.idempotencyKey}`)
            .digest("hex")
        : null;
      if (cacheKey && idempotencyCache.has(cacheKey)) {
        return idempotencyCache.get(cacheKey);
      }

      const result = await context.handler(parsed.input);
      const redacted = redactValue(result, config.redactFields);
      if (cacheKey) idempotencyCache.set(cacheKey, redacted);
      return redacted;
    },
  };
}
