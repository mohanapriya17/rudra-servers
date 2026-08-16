import { describe, expect, it } from "vitest";
import { authorize } from "./index.js";

describe("policies", () => {
  it("allows authenticated role", () => {
    expect(() =>
      authorize(
        { subject: "u1", roles: [], claims: {} },
        { resource: "projects", action: "read", roles: ["authenticated"] },
        "projects",
        "read",
      ),
    ).not.toThrow();
  });

  it("rejects missing roles", () => {
    expect(() =>
      authorize(
        { subject: "u1", roles: ["viewer"], claims: {} },
        { resource: "projects", action: "delete", roles: ["admin"] },
        "projects",
        "delete",
      ),
    ).toThrow();
  });
});
