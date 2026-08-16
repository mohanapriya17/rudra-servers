import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import type { Identity } from "@rudra/contracts";
import { RudraError } from "@rudra/errors";

export type { Identity };

function b64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64url");
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function generateApiKey(prefix = "rk"): { key: string; prefix: string; hash: string } {
  const secret = randomBytes(24).toString("base64url");
  const key = `${prefix}_${secret}`;
  return {
    key,
    prefix: key.slice(0, 10),
    hash: hashApiKey(key),
  };
}

export function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  options?: { expiresInSeconds?: number },
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    ...(options?.expiresInSeconds ? { exp: now + options.expiresInSeconds } : {}),
  };
  const encoded = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyJwt(token: string, secret: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new RudraError("UNAUTHORIZED", "Invalid token");
  }
  const [headerB64, payloadB64, signature] = parts as [string, string, string];
  const encoded = `${headerB64}.${payloadB64}`;
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new RudraError("UNAUTHORIZED", "Invalid token signature");
  }
  const payload = JSON.parse(fromB64url(payloadB64).toString("utf8")) as Record<string, unknown>;
  if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new RudraError("UNAUTHORIZED", "Token expired");
  }
  return payload;
}

export function identityFromJwtPayload(payload: Record<string, unknown>): Identity {
  const subject = typeof payload.sub === "string" ? payload.sub : null;
  if (!subject) {
    throw new RudraError("UNAUTHORIZED", "Token missing subject");
  }
  return {
    subject,
    applicationId: typeof payload.applicationId === "string" ? payload.applicationId : undefined,
    environmentId: typeof payload.environmentId === "string" ? payload.environmentId : undefined,
    roles: Array.isArray(payload.roles)
      ? payload.roles.filter((role): role is string => typeof role === "string")
      : [],
    claims: typeof payload.claims === "object" && payload.claims !== null
      ? (payload.claims as Record<string, unknown>)
      : {},
  };
}

export function parseBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token;
}

export function serviceIdentity(serviceName: string): Identity {
  return {
    subject: `service:${serviceName}`,
    roles: ["service"],
    claims: { service: serviceName },
  };
}
