import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

describe("graphql-api", () => {
  const { app } = createApp({
    contextDefaults: {
      postgresEndpoints: new Map(),
      mongoEndpoints: new Map(),
      allowedRestHosts: new Set(["*"]),
      fetchImpl: async () =>
        new Response("72F", {
          headers: { "content-type": "text/plain" },
        }),
    },
  });

  it("health", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });

  it("creates schema and executes query with static/parent/rest resolvers", async () => {
    const created = await request(app).post("/api/v1/graphql/schemas").send({
      name: "application-api",
      types: [
        {
          name: "Project",
          fields: [
            { name: "id", type: "ID!", resolver: { type: "parent", field: "id" } },
            { name: "name", type: "String!", resolver: { type: "parent", field: "name" } },
            {
              name: "weather",
              type: "String",
              resolver: {
                type: "rest",
                method: "GET",
                url: "https://example.com/weather/{city}",
                params: { city: "$parent.city" },
              },
            },
          ],
        },
      ],
      queries: [
        {
          name: "projects",
          type: "[Project!]!",
          resolver: {
            type: "static",
            value: [{ id: "1", name: "Website", city: "Austin" }],
          },
        },
      ],
    });
    expect(created.status).toBe(201);

    const result = await request(app).post("/graphql?schema=application-api").send({
      query: `{ projects { id name weather } }`,
    });
    expect(result.status).toBe(200);
    expect(result.body.data.projects[0].name).toBe("Website");
    expect(result.body.data.projects[0].weather).toBeTruthy();
  });
});
