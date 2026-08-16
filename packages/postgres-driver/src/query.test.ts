import { describe, expect, it } from "vitest";
import { buildSelectQuery, buildWhere } from "./query.js";

const resource = {
  name: "projects",
  physicalSchema: "rudra_app_x",
  physicalTable: "resource_abc",
  fields: [
    { name: "id", type: "uuid", primaryKey: true },
    { name: "name", type: "varchar" },
    { name: "status", type: "text" },
    { name: "budget", type: "numeric" },
  ],
};

describe("postgres query builder", () => {
  it("builds parameterized where clauses", () => {
    const built = buildWhere(resource, {
      status: { eq: "ACTIVE" },
      budget: { gte: 10000 },
    });
    expect(built.clause).toContain('"status" = $1');
    expect(built.clause).toContain('"budget" >= $2');
    expect(built.values).toEqual(["ACTIVE", 10000]);
  });

  it("rejects unknown fields", () => {
    expect(() => buildWhere(resource, { hack: { eq: 1 } })).toThrow();
  });

  it("never interpolates logical resource names", () => {
    const query = buildSelectQuery(resource, { limit: 10 });
    expect(query.text).toContain('"rudra_app_x"."resource_abc"');
    expect(query.text).not.toContain("projects");
  });
});
