import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { MemoryControlPlaneStore } from "./store/memory.js";

describe("control-plane-api", () => {
  let store: MemoryControlPlaneStore;
  let app: ReturnType<typeof createApp>["app"];

  beforeEach(() => {
    store = new MemoryControlPlaneStore("test-encryption-key-32b!!");
    app = createApp({ store }).app;
  });

  it("exposes health", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("control-plane-api");
  });

  it("creates apps, environments, secrets without leaking values", async () => {
    const appRes = await request(app).post("/api/v1/apps").send({ name: "Inventory Application" });
    expect(appRes.status).toBe(201);
    const appId = appRes.body.data.id as string;

    const envRes = await request(app)
      .post(`/api/v1/apps/${appId}/environments`)
      .send({ name: "development" });
    expect(envRes.status).toBe(201);
    const environmentId = envRes.body.data.id as string;

    const secretRes = await request(app).post("/api/v1/secrets").send({
      name: "STRIPE_API_KEY",
      value: "secret-value",
      environmentId,
      applicationId: appId,
    });
    expect(secretRes.status).toBe(201);
    expect(secretRes.body.data.configured).toBe(true);
    expect(secretRes.body.data.value).toBeUndefined();
    expect(JSON.stringify(secretRes.body)).not.toContain("secret-value");

    const getSecret = await request(app).get(`/api/v1/secrets/${secretRes.body.data.id}`);
    expect(getSecret.body.data.value).toBeUndefined();
  });

  it("registers datasource, resource, fields, index, relation, api key", async () => {
    const createdApp = await request(app).post("/api/v1/apps").send({ name: "Demo" });
    const appId = createdApp.body.data.id as string;
    const env = await request(app)
      .post(`/api/v1/apps/${appId}/environments`)
      .send({ name: "development" });
    const environmentId = env.body.data.id as string;

    const secret = await request(app).post("/api/v1/secrets").send({
      name: "DATABASE_URL",
      value: "postgres://example",
      environmentId,
      applicationId: appId,
    });

    const ds = await request(app).post("/api/v1/datasources").send({
      applicationId: appId,
      environmentId,
      name: "main-db",
      type: "postgres",
      connectionSecretId: secret.body.data.id,
      ssl: true,
    });
    expect(ds.status).toBe(201);

    const resource = await request(app).post("/api/v1/resources").send({
      dataSourceId: ds.body.data.id,
      name: "projects",
    });
    expect(resource.status).toBe(201);
    expect(resource.body.data.physicalName).toMatch(/^resource_/);
    expect(resource.body.data.physicalSchema).toMatch(/^rudra_app_/);

    const field = await request(app)
      .post(`/api/v1/resources/${resource.body.data.id}/fields`)
      .send({ name: "name", type: "varchar", length: 255, nullable: false });
    expect(field.status).toBe(201);

    const index = await request(app)
      .post(`/api/v1/resources/${resource.body.data.id}/indexes`)
      .send({ name: "projects_name_idx", fields: ["name"], type: "btree" });
    expect(index.status).toBe(201);

    const relation = await request(app)
      .post(`/api/v1/resources/${resource.body.data.id}/relations`)
      .send({
        field: "clientId",
        references: { resource: "clients", field: "id" },
        onDelete: "cascade",
      });
    expect(relation.status).toBe(201);

    const apiKey = await request(app).post("/api/v1/api-keys").send({
      applicationId: appId,
      environmentId,
      name: "ci",
      scopes: ["read", "write"],
    });
    expect(apiKey.status).toBe(201);
    expect(apiKey.body.data.key).toMatch(/^rk_/);

    const listed = await request(app).get("/api/v1/api-keys").query({ applicationId: appId });
    expect(listed.body.data[0].key).toBeUndefined();
  });
});
