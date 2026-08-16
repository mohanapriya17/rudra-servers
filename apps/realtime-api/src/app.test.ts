import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { WebSocket } from "ws";
import { createServer } from "node:http";
import { createApp } from "./app.js";

describe("realtime-api", () => {
  const { app, hub } = createApp();
  const server = createServer(app);
  hub.attach(server);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("health and token", async () => {
    const health = await request(app).get("/health");
    expect(health.status).toBe(200);
    const token = await request(app).post("/api/v1/realtime/tokens").send({ identity: "alice" });
    expect(token.status).toBe(201);
    expect(token.body.data.token).toMatch(/^rt_/);
  });

  it("subscribe/publish between two clients", async () => {
    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.once("error", reject);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no address");
    const base = `ws://127.0.0.1:${address.port}/ws`;

    const a = new WebSocket(base);
    const b = new WebSocket(base);

    await Promise.all([
      new Promise((r) => a.once("open", r)),
      new Promise((r) => b.once("open", r)),
    ]);

    const eventPromise = new Promise<Record<string, unknown>>((resolve) => {
      b.on("message", (raw) => {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>;
        if (msg.type === "event") resolve(msg);
      });
    });

    a.send(JSON.stringify({ type: "subscribe", channel: "project:1" }));
    b.send(JSON.stringify({ type: "subscribe", channel: "project:1" }));
    await new Promise((r) => setTimeout(r, 50));
    a.send(
      JSON.stringify({
        type: "publish",
        channel: "project:1",
        event: "task.updated",
        data: { id: "t1" },
      }),
    );

    const event = await eventPromise;
    expect(event.event).toBe("task.updated");
    a.close();
    b.close();
  });
});
