import { createHash } from "node:crypto";
import { z } from "zod";
import { RudraError } from "@rudra/errors";

export const SessionClaimsSchema = z.object({
  sub: z.string().min(1),
  applicationId: z.string().min(1),
  environmentId: z.string().min(1),
  sessionId: z.string().min(1),
  roles: z.array(z.string()).default([]),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type SessionClaims = z.infer<typeof SessionClaimsSchema>;

export function assertServerSession(session: unknown): SessionClaims {
  const claims = SessionClaimsSchema.parse(session);
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) {
    throw new RudraError("UNAUTHORIZED", "Session expired");
  }
  return claims;
}

export function isSafeRelativeRedirect(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.includes("\\")) return false;
  if (path.includes("\0")) return false;
  const schemeIndex = path.indexOf(":");
  if (schemeIndex >= 0 && schemeIndex < path.indexOf("/")) return false;
  return true;
}

export function allowlistedRouteRedirect(
  routeId: string,
  routes: Record<string, string>,
): string {
  const pathname = routes[routeId];
  if (!pathname || !isSafeRelativeRedirect(pathname)) {
    throw new RudraError("VALIDATION_ERROR", "Redirect route is not allowlisted", {
      details: { routeId },
    });
  }
  return pathname;
}

export function sessionCookieAttributes(options?: {
  secure?: boolean;
  domain?: string;
  maxAgeSeconds?: number;
}): Record<string, string | boolean | number> {
  return {
    httpOnly: true,
    secure: options?.secure ?? true,
    sameSite: "lax",
    path: "/",
    ...(options?.domain ? { domain: options.domain } : {}),
    ...(options?.maxAgeSeconds ? { maxAge: options.maxAgeSeconds } : {}),
  };
}

export function hashSubject(subject: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${subject}`).digest("hex");
}
