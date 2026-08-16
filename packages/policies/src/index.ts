import type { Identity } from "@rudra/contracts";
import { RudraError } from "@rudra/errors";

export const POLICY_ACTIONS = [
  "create",
  "read",
  "update",
  "delete",
  "query",
  "subscribe",
  "publish",
  "upload",
  "download",
  "execute",
] as const;

export type PolicyAction = (typeof POLICY_ACTIONS)[number];

export interface PolicyRule {
  resource: string;
  action: PolicyAction | "*";
  roles: string[];
}

export function authorize(
  identity: Identity,
  rule: PolicyRule,
  resource: string,
  action: PolicyAction,
): void {
  if (rule.resource !== "*" && rule.resource !== resource) {
    throw new RudraError("FORBIDDEN", "Policy resource mismatch");
  }
  if (rule.action !== "*" && rule.action !== action) {
    throw new RudraError("FORBIDDEN", "Policy action mismatch");
  }
  if (rule.roles.includes("*") || rule.roles.includes("authenticated")) {
    return;
  }
  const allowed = rule.roles.some((role) => identity.roles.includes(role));
  if (!allowed) {
    throw new RudraError("FORBIDDEN", `Missing role for ${action} on ${resource}`);
  }
}

export function assertAnyRole(identity: Identity, roles: string[]): void {
  if (roles.includes("*")) return;
  if (roles.includes("authenticated") && identity.subject) return;
  if (roles.some((role) => identity.roles.includes(role))) return;
  throw new RudraError("FORBIDDEN", "Insufficient role");
}
