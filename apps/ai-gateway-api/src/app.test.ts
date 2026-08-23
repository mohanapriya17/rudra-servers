import { describe, expect, it } from "vitest";
import request from "supertest";
import { createGatewayApp } from "./app.js";
import { signServiceToken } from "./auth/jwt.js";
import { loadGatewayConfig } from "./config.js";

function mintToken(overrides?: Partial<Parameters<typeof signServiceToken>[0]>) {
  const config = loadGatewayConfig({ NODE_ENV: "test" });
  return signServiceToken(
    {
      iss: config.RUDRA_AI_GATEWAY_ISSUER,
      aud: config.RUDRA_AI_GATEWAY_AUDIENCE,
      sub: "session:test-user",
      applicationId: "app_demo",
      environmentId: "development",
      assistantIds: ["app_demo", "development", "support"],
      requestId: "req-test-1",
      ...overrides,
    },
    config.RUDRA_AI_GATEWAY_SIGNING_SECRET,
  );
}

describe("ai-gateway-api", () => {
  const config = loadGatewayConfig({ NODE_ENV: "test" });
  const { app } = createGatewayApp({ config });

  it("exposes health endpoints", async () => {
    const health = await request(app).get("/health");
    expect(health.status).toBe(200);
    expect(health.body.service).toBe("ai-gateway-api");

    const live = await request(app).get("/health/live");
    expect(live.status).toBe(200);
    expect(live.body.status).toBe("live");

    const ready = await request(app).get("/ready");
    expect(ready.status).toBe(200);
    expect(ready.body.status).toBe("ready");
  });

  it("rejects browser Origin header", async () => {
    const res = await request(app)
      .post("/v1/chat")
      .set("Origin", "https://evil.example")
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects unauthenticated chat", async () => {
    const res = await request(app).post("/v1/chat").send({
      version: 1,
      assistantId: "app_demo",
      message: { id: "m1", role: "user", content: "Hello" },
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("completes fake chat", async () => {
    const token = mintToken();
    const res = await request(app)
      .post("/v1/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({
        version: 1,
        assistantId: "app_demo",
        conversationId: "conv-1",
        message: { id: "m1", role: "user", content: "Hello" },
        history: [],
      });
    expect(res.status).toBe(200);
    expect(res.body.message.role).toBe("assistant");
    expect(res.body.usage.provider).toBe("fake");
    expect(res.body.message.parts[0].text).toContain("Fake assistant response");
  });

  it("streams SSE terminal event", async () => {
    const token = mintToken();
    const res = await request(app)
      .post("/v1/chat/stream")
      .set("Authorization", `Bearer ${token}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks).toString("utf8")));
      })
      .send({
        version: 1,
        assistantId: "app_demo",
        conversationId: "conv-stream-1",
        message: { id: "m1", role: "user", content: "Stream please" },
        history: [],
      });

    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toContain("text/event-stream");
    const body = typeof res.body === "string" ? res.body : String(res.body ?? "");
    expect(body).toContain("response.completed");
  });

  it("rejects unauthorized assistant", async () => {
    const token = mintToken({ assistantIds: ["support"] });
    const res = await request(app)
      .post("/v1/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({
        version: 1,
        assistantId: "app_demo",
        message: { id: "m1", role: "user", content: "Hello" },
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("accepts feedback", async () => {
    const token = mintToken();
    const res = await request(app)
      .post("/v1/feedback")
      .set("Authorization", `Bearer ${token}`)
      .send({
        version: 1,
        assistantId: "app_demo",
        conversationId: "conv-1",
        messageId: "msg-1",
        rating: "up",
      });
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(true);
  });
});
