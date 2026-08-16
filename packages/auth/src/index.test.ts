import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, identityFromJwtPayload, signJwt, verifyJwt } from "./index.js";

describe("auth", () => {
  it("hashes api keys stably", () => {
    const { key, hash } = generateApiKey();
    expect(hashApiKey(key)).toBe(hash);
  });

  it("signs and verifies jwt", () => {
    const token = signJwt({ sub: "user-1", roles: ["admin"] }, "secret", {
      expiresInSeconds: 60,
    });
    const payload = verifyJwt(token, "secret");
    const identity = identityFromJwtPayload(payload);
    expect(identity.subject).toBe("user-1");
    expect(identity.roles).toContain("admin");
  });
});
