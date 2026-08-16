import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

const MONGODB_URL = process.env.MONGODB_TEST_URL ?? "mongodb://127.0.0.1:27017";

describe("mongodb-api phase 3 acceptance", () => {
  const { app, clients } = createApp();
  const sourceName = "mongo-main";

  beforeAll(async () => {
    const res = await request(app).post("/api/v1/mongodb/datasources").send({
      name: sourceName,
      connectionString: MONGODB_URL,
      database: "rudra_test",
      applicationId: "app-mongo-01",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.connectionString).toBeUndefined();
  });

  afterAll(async () => {
    await clients.closeAll();
  });

  it("exposes health", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("mongodb-api");
  });

  it("creates collection with validator, CRUD, query, aggregate, bulk", async () => {
    const resource = await request(app).post(`/api/v1/mongodb/${sourceName}/resources`).send({
      name: "messages",
      schema: {
        senderId: { type: "objectId", required: true },
        message: { type: "string", required: true },
        status: { type: "string", required: true },
        meta: {
          type: "object",
          properties: {
            channel: { type: "string", required: true },
            pinned: { type: "boolean" },
          },
        },
        tags: {
          type: "array",
          items: { type: "string" },
        },
        createdAt: { type: "date" },
      },
      validationLevel: "strict",
    });
    expect(resource.status).toBe(201);
    expect(resource.body.data.physicalCollection).toMatch(/^resource_/);

    const index = await request(app)
      .post(`/api/v1/mongodb/${sourceName}/resources/messages/indexes`)
      .send({
        name: "messages_user_created_idx",
        fields: { senderId: 1, createdAt: -1 },
      });
    expect(index.status).toBe(201);

    const created = await request(app).post(`/api/v1/mongodb/${sourceName}/data/messages`).send({
      senderId: "507f1f77bcf86cd799439011",
      message: "hello world",
      status: "active",
      meta: { channel: "general", pinned: false },
      tags: ["intro"],
      createdAt: new Date().toISOString(),
    });
    expect(created.status).toBe(201);
    expect(created.body.data.id).toBeTruthy();
    expect(created.body.data.message).toBe("hello world");
    const id = created.body.data.id as string;

    // Nested document create via bulk
    const bulk = await request(app).post(`/api/v1/mongodb/${sourceName}/data/messages/bulk`).send({
      records: [
        {
          senderId: "507f1f77bcf86cd799439011",
          message: "second",
          status: "active",
          meta: { channel: "general" },
          tags: ["a"],
        },
        {
          senderId: "507f1f77bcf86cd799439012",
          message: "third",
          status: "archived",
          meta: { channel: "ops" },
          tags: ["b"],
        },
      ],
    });
    expect(bulk.status).toBe(201);
    expect(bulk.body.data).toHaveLength(2);

    const listed = await request(app).get(
      `/api/v1/mongodb/${sourceName}/data/messages?page=1&limit=20&sort=createdAt&order=desc`,
    );
    expect(listed.status).toBe(200);
    expect(listed.body.data.length).toBeGreaterThanOrEqual(3);

    const one = await request(app).get(`/api/v1/mongodb/${sourceName}/data/messages/${id}`);
    expect(one.status).toBe(200);
    expect(one.body.data.id).toBe(id);

    const queried = await request(app)
      .post(`/api/v1/mongodb/${sourceName}/data/messages/query`)
      .send({
        where: { status: { eq: "active" } },
        sort: [{ field: "createdAt", direction: "desc" }],
        limit: 20,
      });
    expect(queried.status).toBe(200);
    expect(queried.body.data.every((row: { status: string }) => row.status === "active")).toBe(
      true,
    );

    const updated = await request(app)
      .patch(`/api/v1/mongodb/${sourceName}/data/messages/${id}`)
      .send({ message: "hello updated", status: "active" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.message).toBe("hello updated");

    const aggregated = await request(app)
      .post(`/api/v1/mongodb/${sourceName}/data/messages/aggregate`)
      .send({
        stages: [
          { stage: "match", spec: { status: { eq: "active" } } },
          { stage: "group", spec: { _id: "$status", total: { $sum: 1 } } },
          { stage: "sort", spec: [{ field: "total", direction: "desc" }] },
        ],
      });
    expect(aggregated.status).toBe(200);
    expect(aggregated.body.data.length).toBeGreaterThanOrEqual(1);

    // Reject operator injection
    const injected = await request(app)
      .post(`/api/v1/mongodb/${sourceName}/data/messages/query`)
      .send({
        where: { status: { $where: "1 == 1" } },
      });
    expect(injected.status).toBe(400);

    const rejectedStage = await request(app)
      .post(`/api/v1/mongodb/${sourceName}/data/messages/aggregate`)
      .send({
        stages: [{ stage: "out", spec: "evil" }],
      });
    expect(rejectedStage.status).toBe(400);

    const deleted = await request(app).delete(
      `/api/v1/mongodb/${sourceName}/data/messages/${id}`,
    );
    expect(deleted.status).toBe(200);
  });

  it("rejects documents that fail schema validation", async () => {
    const res = await request(app).post(`/api/v1/mongodb/${sourceName}/data/messages`).send({
      message: "missing sender",
      status: "active",
    });
    expect(res.status).toBe(400);
  });
});
