import { describe, expect, it } from "vitest";
import { assertResourceSlug, buildPostgresColumnType, physicalTableName, quoteIdent } from "./index.js";

describe("metadata", () => {
  it("validates resource slugs", () => {
    expect(assertResourceSlug("projects")).toBe("projects");
    expect(() => assertResourceSlug("Bad Name")).toThrow();
  });

  it("quotes identifiers safely", () => {
    expect(quoteIdent("projects")).toBe('"projects"');
  });

  it("builds column types", () => {
    expect(buildPostgresColumnType({ type: "varchar", length: 255 })).toBe("varchar(255)");
    expect(buildPostgresColumnType({ type: "text", array: true })).toBe("text[]");
  });

  it("generates physical table names", () => {
    expect(physicalTableName("abc123")).toMatch(/^resource_/);
  });
});
