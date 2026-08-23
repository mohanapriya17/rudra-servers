import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MAX_TOKEN_LIFETIME_SECONDS,
  parseBearer,
  signServiceToken,
  verifyServiceToken,
} from "./jwt.js";

const secret = "test-signing-secret-32chars-min!!";
const issuer = "https://test.rudra.example";
const audience = "rudra-ai-gateway";

function baseClaims() {
  return {
    iss: issuer,
    aud: audience,
    sub: "session:user-1",
    applicationId: "app_demo",
    environmentId: "development",
    assistantIds: ["app_demo", "support"],
    requestId: "req-test-1",
  };
}

describe("jwt", () => {
  it("signs and verifies a service token", () => {
    const token = signServiceToken(baseClaims(), secret);
    const claims = verifyServiceToken(token, secret, { issuer, audience });
    expect(claims.applicationId).toBe("app_demo");
    expect(claims.assistantIds).toEqual(["app_demo", "support"]);
  });

  it("rejects tokens exceeding max lifetime", () => {
    const token = signServiceToken(baseClaims(), secret, { lifetimeSeconds: MAX_TOKEN_LIFETIME_SECONDS });
    const parts = token.split(".");
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, number>;
    payload.iat = Math.floor(Date.now() / 1000) - 120;
    payload.exp = Math.floor(Date.now() / 1000) + 30;
    const tampered = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${parts[2]}`;
    expect(() => verifyServiceToken(tampered, secret, { issuer, audience })).toThrow();
  });

  it("rejects invalid claims shape", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: issuer, aud: audience })).toString("base64url");
    const encoded = `${header}.${payload}`;
    const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
    expect(() => verifyServiceToken(`${encoded}.${signature}`, secret, { issuer, audience })).toThrow();
  });

  it("parses bearer tokens", () => {
    expect(parseBearer("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(parseBearer("Basic abc")).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
  });
});
