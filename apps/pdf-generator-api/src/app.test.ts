import { describe, expect, it } from "vitest";
import request from "supertest";
import { MemoryRateLimiter } from "@rudra/rate-limit";
import { createApp } from "./app.js";
import { createTestAuthVerifier } from "./auth/firebase.js";
import { MAX_ROWS_PER_USER } from "./parse/data.js";

function asBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body, "binary");
  return Buffer.from(body as Uint8Array);
}

describe("pdf-generator-api", () => {
  const auth = createTestAuthVerifier();
  const { app } = createApp({
    auth,
    jobLimiter: new MemoryRateLimiter({ windowMs: 60_000, max: 20 }),
  });

  it("exposes health", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("pdf-generator-api");
    expect(res.body.status).toBe("ok");
  });

  it("rejects unauthenticated generate", async () => {
    const res = await request(app).post("/api/v1/pdf/generate").send({
      template: "Hello {{name}}",
      data: { name: "Ada" },
    });
    expect(res.status).toBe(401);
  });

  it("generates a zip of PDFs from JSON rows", async () => {
    const res = await request(app)
      .post("/api/v1/pdf/generate")
      .set("Authorization", "Bearer test:user-1")
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .send({
        template: "Hello {{name}}\nTotal: {{amount}}",
        data: [
          { name: "Ada", amount: "10" },
          { name: "Lin", amount: "20" },
        ],
        fileNamePrefix: "invoice",
      });

    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toMatch(/zip/);
    expect(res.headers["x-rudra-row-count"]).toBe("2");
    expect(res.headers["x-rudra-row-limit"]).toBe(String(MAX_ROWS_PER_USER));
    const buf = asBuffer(res.body);
    expect(buf.length).toBeGreaterThan(100);
    expect(buf.subarray(0, 2).toString("binary")).toBe("PK");
  });

  it("accepts CSV upload", async () => {
    const csv = "name,amount\nAda,10\nLin,20\n";
    const res = await request(app)
      .post("/api/v1/pdf/generate")
      .set("Authorization", "Bearer test:user-2")
      .field("template", "Customer {{name}} owes {{amount}}")
      .attach("data", Buffer.from(csv, "utf8"), {
        filename: "rows.csv",
        contentType: "text/csv",
      })
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["x-rudra-row-count"]).toBe("2");
    const buf = asBuffer(res.body);
    expect(buf.subarray(0, 2).toString("binary")).toBe("PK");
  });

  it("rejects more than 10 rows", async () => {
    const data = Array.from({ length: 11 }, (_, i) => ({ name: `u${i}`, amount: String(i) }));
    const res = await request(app)
      .post("/api/v1/pdf/generate")
      .set("Authorization", "Bearer test:user-3")
      .send({
        template: "Hi {{name}}",
        data,
      });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
  });

  it("returns limits for authenticated users", async () => {
    const res = await request(app)
      .get("/api/v1/pdf/limits")
      .set("Authorization", "Bearer test:user-4");
    expect(res.status).toBe(200);
    expect(res.body.data.maxRowsPerRequest).toBe(10);
  });
});
