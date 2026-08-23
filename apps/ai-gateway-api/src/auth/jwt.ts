import { createHmac, timingSafeEqual } from "node:crypto";
import {
  ServiceTokenClaimsSchema,
  type ServiceTokenClaims,
} from "@rudra/ai-contracts";
import { GatewayHttpError } from "../errors.js";

export const MAX_TOKEN_LIFETIME_SECONDS = 60;

function b64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64url");
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

export function signServiceToken(
  claims: Omit<ServiceTokenClaims, "iat" | "exp">,
  secret: string,
  options?: { lifetimeSeconds?: number },
): string {
  const lifetime = Math.min(options?.lifetimeSeconds ?? MAX_TOKEN_LIFETIME_SECONDS, MAX_TOKEN_LIFETIME_SECONDS);
  const now = Math.floor(Date.now() / 1000);
  const payload: ServiceTokenClaims = {
    ...claims,
    iat: now,
    exp: now + lifetime,
  };
  ServiceTokenClaimsSchema.parse(payload);

  const header = { alg: "HS256", typ: "JWT" };
  const encoded = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyServiceToken(
  token: string,
  secret: string,
  options: { issuer: string; audience: string },
): ServiceTokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new GatewayHttpError("UNAUTHENTICATED", "Invalid service token.", 401);
  }

  const [headerB64, payloadB64, signature] = parts as [string, string, string];
  const encoded = `${headerB64}.${payloadB64}`;
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new GatewayHttpError("UNAUTHENTICATED", "Invalid service token.", 401);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fromB64url(payloadB64).toString("utf8"));
  } catch {
    throw new GatewayHttpError("UNAUTHENTICATED", "Invalid service token.", 401);
  }

  const claims = ServiceTokenClaimsSchema.parse(raw);
  const now = Math.floor(Date.now() / 1000);

  if (claims.exp <= now) {
    throw new GatewayHttpError("UNAUTHENTICATED", "Service token expired.", 401);
  }
  if (claims.exp - claims.iat > MAX_TOKEN_LIFETIME_SECONDS) {
    throw new GatewayHttpError("UNAUTHENTICATED", "Service token lifetime exceeds limit.", 401);
  }
  if (claims.iss !== options.issuer) {
    throw new GatewayHttpError("UNAUTHENTICATED", "Invalid token issuer.", 401);
  }
  if (claims.aud !== options.audience) {
    throw new GatewayHttpError("UNAUTHENTICATED", "Invalid token audience.", 401);
  }

  return claims;
}

export function parseBearer(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token;
}
