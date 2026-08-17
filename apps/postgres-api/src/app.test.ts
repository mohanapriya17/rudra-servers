import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "./app.js";
import { PostgresRegistry } from "./registry.js";
import { PoolManager } from "./pool-manager.js";
import { PostgresRegistryStore } from "./store/registry-store.js";
import type { RegistryStore } from "./store/registry-store.js";

const DATABASE_URL =
  process.env.POSTGRES_TEST_URL ?? "postgres://rudra:rudra@127.0.0.1:5432/rudra_data";
const RUN_ID = `app-test-${Date.now().toString(36)}`;

describe("postgres-api phase 2 acceptance", () => {
  let app: Express;
  let pools: PoolManager;
  let store: RegistryStore;
  let sourceId = "";
  const sourceName = `main_${Date.now().toString(36)}`;

  beforeAll(async () => {
    const created = await createApp({ skipEnvStore: true });
    app = created.app;
    pools = created.pools;
    store = created.store;

    const res = await request(app).post("/api/v1/postgres/datasources").send({
      name: sourceName,
      connectionString: DATABASE_URL,
      ssl: false,
      applicationId: RUN_ID,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.connectionString).toBeUndefined();
    sourceId = res.body.data.id;
  });

  afterAll(async () => {
    await pools.closeAll();
    await store.close();
  });

  it("exposes health", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("postgres-api");
    expect(res.body.registryStore).toBe("memory");
  });

  it("creates resource, fields, index, CRUD, query, upsert, bulk, transaction", async () => {
    const clients = await request(app).post(`/api/v1/postgres/${sourceName}/resources`).send({
      name: "clients",
      fields: [
        { name: "id", type: "uuid", primaryKey: true, default: "uuid" },
        { name: "name", type: "varchar", length: 255, nullable: false },
      ],
    });
    expect(clients.status).toBe(201);
    expect(clients.body.data.physicalTable).toMatch(/^resource_/);
    expect(clients.body.data.physicalSchema).toMatch(/^rudra_app_/);

    const projects = await request(app).post(`/api/v1/postgres/${sourceId}/resources`).send({
      name: "projects",
      fields: [
        { name: "id", type: "uuid", primaryKey: true, default: "uuid" },
        { name: "name", type: "varchar", length: 255, nullable: false },
        { name: "status", type: "text", nullable: false, default: "ACTIVE" },
        { name: "budget", type: "numeric", precision: 12, scale: 2 },
        { name: "clientId", type: "uuid", nullable: true },
        { name: "createdAt", type: "timestamptz", default: "now" },
      ],
    });
    expect(projects.status).toBe(201);

    const index = await request(app)
      .post(`/api/v1/postgres/${sourceName}/resources/projects/indexes`)
      .send({
        name: "project_status_created_idx",
        type: "btree",
        fields: ["status", "createdAt"],
      });
    expect(index.status).toBe(201);

    const relation = await request(app)
      .post(`/api/v1/postgres/${sourceName}/resources/projects/relations`)
      .send({
        field: "clientId",
        references: { resource: "clients", field: "id" },
        onDelete: "set null",
        onUpdate: "cascade",
      });
    expect(relation.status).toBe(201);

    const emailField = await request(app)
      .post(`/api/v1/postgres/${sourceName}/resources/clients/fields`)
      .send({ name: "email", type: "varchar", length: 255, unique: true });
    expect(emailField.status).toBe(201);

    const client = await request(app).post(`/api/v1/postgres/${sourceName}/data/clients`).send({
      name: "Acme",
      email: "hello@example.com",
    });
    expect(client.status).toBe(201);
    const clientId = client.body.data.id as string;

    const created = await request(app).post(`/api/v1/postgres/${sourceName}/data/projects`).send({
      name: "Website Redesign",
      status: "ACTIVE",
      budget: 100000,
      clientId,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe("Website Redesign");
    const projectId = created.body.data.id as string;

    const listed = await request(app).get(
      `/api/v1/postgres/${sourceName}/data/projects?page=1&limit=20&sort=createdAt&order=desc`,
    );
    expect(listed.status).toBe(200);
    expect(listed.body.data.length).toBeGreaterThanOrEqual(1);

    const one = await request(app).get(
      `/api/v1/postgres/${sourceName}/data/projects/${projectId}`,
    );
    expect(one.status).toBe(200);
    expect(one.body.data.id).toBe(projectId);

    const queried = await request(app)
      .post(`/api/v1/postgres/${sourceName}/data/projects/query`)
      .send({
        where: {
          status: { eq: "ACTIVE" },
          budget: { gte: 10000 },
        },
        orderBy: [{ field: "createdAt", direction: "desc" }],
        limit: 20,
        offset: 0,
      });
    expect(queried.status).toBe(200);
    expect(queried.body.data.length).toBeGreaterThan(0);

    const aggregated = await request(app)
      .post(`/api/v1/postgres/${sourceName}/data/projects/query`)
      .send({
        where: { status: { eq: "ACTIVE" } },
        aggregate: { count: true, sum: ["budget"] },
      });
    expect(aggregated.status).toBe(200);
    expect(aggregated.body.data[0].count).toBeGreaterThanOrEqual(1);

    const updated = await request(app)
      .patch(`/api/v1/postgres/${sourceName}/data/projects/${projectId}`)
      .send({ status: "DONE", budget: 120000 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.status).toBe("DONE");

    const upserted = await request(app)
      .post(`/api/v1/postgres/${sourceName}/data/clients/upsert`)
      .send({
        conflictFields: ["email"],
        data: { name: "Siva", email: "hello@example.com" },
      });
    expect(upserted.status).toBe(200);
    expect(upserted.body.data.name).toBe("Siva");

    const bulk = await request(app)
      .post(`/api/v1/postgres/${sourceName}/data/projects/bulk`)
      .send({
        records: [
          { name: "A", status: "ACTIVE", budget: 1 },
          { name: "B", status: "ACTIVE", budget: 2 },
        ],
      });
    expect(bulk.status).toBe(201);
    expect(bulk.body.data).toHaveLength(2);

    const tx = await request(app).post(`/api/v1/postgres/${sourceName}/transaction`).send({
      operations: [
        {
          operation: "create",
          resource: "projects",
          data: { name: "Tx Project", status: "ACTIVE", budget: 50 },
        },
        {
          operation: "update",
          resource: "projects",
          id: projectId,
          data: { name: "Website Redesign v2" },
        },
      ],
    });
    expect(tx.status).toBe(200);
    expect(tx.body.data).toHaveLength(2);

    const missing = await request(app).get(`/api/v1/postgres/${sourceName}/data/not_a_table`);
    expect(missing.status).toBe(404);

    const deleted = await request(app).delete(
      `/api/v1/postgres/${sourceName}/data/projects/${projectId}`,
    );
    expect(deleted.status).toBe(200);

    const dropField = await request(app).delete(
      `/api/v1/postgres/${sourceName}/resources/projects/fields/budget?confirm=true`,
    );
    expect(dropField.status).toBe(200);
  });

  it("rejects unsafe field delete without confirm", async () => {
    const res = await request(app).delete(
      `/api/v1/postgres/${sourceName}/resources/projects/fields/status`,
    );
    expect(res.status).toBe(400);
  });
});

describe("postgres-api registry persistence", () => {
  const sourceName = `persist_${Date.now().toString(36)}`;
  const encryptionKey = "test-metadata-encryption-key!!";

  it("rehydrates datasources and resources after restart", async () => {
    const firstStore = new PostgresRegistryStore(DATABASE_URL, encryptionKey);
    const firstRegistry = new PostgresRegistry();
    const firstPools = new PoolManager(firstRegistry);
    const first = await createApp({
      registry: firstRegistry,
      pools: firstPools,
      store: firstStore,
    });

    const ds = await request(first.app).post("/api/v1/postgres/datasources").send({
      name: sourceName,
      connectionString: DATABASE_URL,
      ssl: false,
      applicationId: `persist-${Date.now().toString(36)}`,
    });
    expect(ds.status).toBe(201);

    const resource = await request(first.app)
      .post(`/api/v1/postgres/${sourceName}/resources`)
      .send({
        name: "items",
        fields: [
          { name: "id", type: "uuid", primaryKey: true, default: "uuid" },
          { name: "title", type: "varchar", length: 120, nullable: false },
        ],
      });
    expect(resource.status).toBe(201);
    const physicalTable = resource.body.data.physicalTable as string;

    await firstPools.closeAll();
    await firstStore.close();

    const secondStore = new PostgresRegistryStore(DATABASE_URL, encryptionKey);
    const secondRegistry = new PostgresRegistry();
    const secondPools = new PoolManager(secondRegistry);
    const second = await createApp({
      registry: secondRegistry,
      pools: secondPools,
      store: secondStore,
    });

    const health = await request(second.app).get("/health");
    expect(health.body.registryStore).toBe("postgres");

    const listed = await request(second.app).get("/api/v1/postgres/datasources");
    expect(listed.status).toBe(200);
    expect(listed.body.data.some((item: { name: string }) => item.name === sourceName)).toBe(
      true,
    );

    const loaded = await request(second.app).get(
      `/api/v1/postgres/${sourceName}/resources/items`,
    );
    expect(loaded.status).toBe(200);
    expect(loaded.body.data.physicalTable).toBe(physicalTable);

    const row = await request(second.app)
      .post(`/api/v1/postgres/${sourceName}/data/items`)
      .send({ title: "persisted" });
    expect(row.status).toBe(201);

    await secondPools.closeAll();
    await secondStore.close();
  });
});
