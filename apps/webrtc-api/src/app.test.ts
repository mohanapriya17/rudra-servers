import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

describe("webrtc-api phase 7", () => {
  const { app } = createApp();

  it("creates room with media capabilities and join credentials", async () => {
    const room = await request(app).post("/api/v1/webrtc/rooms");
    expect(room.status).toBe(201);
    expect(room.body.data.media.screen).toBe(true);
    expect(room.body.data.iceServers.length).toBeGreaterThan(0);

    const join = await request(app)
      .post(`/api/v1/webrtc/rooms/${room.body.data.roomId}/join`)
      .send({ token: room.body.data.token, name: "Alice", capabilities: { screen: true } });
    expect(join.status).toBe(201);
    expect(join.body.data.capabilities.screen).toBe(true);
  });
});
