import { describe, expect, it } from "vitest";
import { translateAggregateStages, translateWhere } from "./query.js";

describe("mongo query translation", () => {
  it("translates structured filters", () => {
    const filter = translateWhere({
      status: { eq: "active" },
      count: { gte: 1 },
    });
    expect(filter).toEqual({
      $and: [{ status: { $eq: "active" } }, { count: { $gte: 1 } }],
    });
  });

  it("rejects operator injection", () => {
    expect(() => translateWhere({ status: { $where: "true" } })).toThrow();
  });

  it("allowlists aggregate stages", () => {
    const pipeline = translateAggregateStages([
      { stage: "match", spec: { status: { eq: "active" } } },
      { stage: "limit", spec: 10 },
    ]);
    expect(pipeline[0]).toHaveProperty("$match");
    expect(pipeline[1]).toEqual({ $limit: 10 });
    expect(() => translateAggregateStages([{ stage: "out", spec: "x" }])).toThrow();
  });
});
