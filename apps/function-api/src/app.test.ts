import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

describe("function-api", () => {
  const { app } = createApp();

  it("creates and invokes trusted function", async () => {
    const created = await request(app).post("/api/v1/functions").send({
      name: "calculatePrice",
      code: `
        async function handler(ctx) {
          const qty = Number(ctx.input?.qty ?? 1);
          const unit = Number(ctx.input?.unit ?? 10);
          ctx.logger.info("calculating", { qty, unit });
          return { total: qty * unit, currency: "USD" };
        }
      `,
      triggers: ["http", "webhook"],
      timeoutMs: 3000,
    });
    expect(created.status).toBe(201);

    const invoked = await request(app)
      .post(`/api/v1/functions/${created.body.data.id}/invoke`)
      .send({ input: { qty: 3, unit: 12 } });
    expect(invoked.status).toBe(200);
    expect(invoked.body.data.total).toBe(36);

    const webhook = await request(app)
      .post(`/api/v1/functions/${created.body.data.name}/webhook`)
      .send({ qty: 2, unit: 5 });
    expect(webhook.status).toBe(200);
  });

  it("times out long functions", async () => {
    const created = await request(app).post("/api/v1/functions").send({
      name: "slowFn",
      timeoutMs: 50,
      code: `
        async function handler() {
          await new Promise((r) => setTimeout(r, 500));
          return { ok: true };
        }
      `,
    });
    const invoked = await request(app)
      .post(`/api/v1/functions/${created.body.data.id}/invoke`)
      .send({ input: {} });
    expect(invoked.status).toBe(503);
  });
});
