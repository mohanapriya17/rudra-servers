import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Logger } from "@rudra/logging";
import { MemoryRateLimiter } from "@rudra/rate-limit";

interface ClientState {
  id: string;
  identity: string;
  channels: Set<string>;
  presence: Record<string, unknown>;
  lastPong: number;
}

interface ChannelState {
  members: Set<string>;
  presence: Map<string, Record<string, unknown>>;
}

export class RealtimeHub {
  private clients = new Map<WebSocket, ClientState>();
  private channels = new Map<string, ChannelState>();
  private messageLimiter = new MemoryRateLimiter({ windowMs: 60_000, max: 120 });
  private readonly maxSubscriptions: number;

  constructor(
    private readonly logger: Logger,
    options?: { maxSubscriptions?: number; authSecret?: string },
  ) {
    this.maxSubscriptions = options?.maxSubscriptions ?? 50;
    this.authSecret = options?.authSecret ?? process.env.JWT_SECRET ?? "dev-jwt-secret-change-me";
  }

  private readonly authSecret: string;

  attach(server: Server): WebSocketServer {
    const wss = new WebSocketServer({
      noServer: true,
      maxPayload: 1_000_000,
    });

    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "", "http://localhost");
      if (url.pathname !== "/ws") return;

      wss.handleUpgrade(req, socket, head, (websocket) => {
        wss.emit("connection", websocket, req);
      });
    });

    const heartbeat = setInterval(() => {
      const now = Date.now();
      for (const [socket, state] of this.clients) {
        if (now - state.lastPong > 45_000) {
          socket.terminate();
          continue;
        }
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping", t: now }));
        }
      }
    }, 15_000);

    wss.on("close", () => clearInterval(heartbeat));

    wss.on("connection", (socket, req) => {
      try {
        this.authenticate(req.url ?? "");
      } catch (error) {
        socket.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
        socket.close();
        return;
      }

      const state: ClientState = {
        id: randomUUID(),
        identity: this.identityFromUrl(req.url ?? "") ?? `anon-${randomUUID().slice(0, 6)}`,
        channels: new Set(),
        presence: {},
        lastPong: Date.now(),
      };
      this.clients.set(socket, state);
      socket.send(JSON.stringify({ type: "welcome", clientId: state.id, identity: state.identity }));

      socket.on("message", (raw) => {
        try {
          this.messageLimiter.consume(state.id);
        } catch {
          socket.send(JSON.stringify({ type: "error", message: "Rate limit exceeded" }));
          return;
        }

        let message: Record<string, unknown>;
        try {
          message = JSON.parse(String(raw)) as Record<string, unknown>;
        } catch {
          socket.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
          return;
        }

        this.handleMessage(socket, state, message);
      });

      socket.on("close", () => {
        this.leaveAll(socket, state);
        this.clients.delete(socket);
      });
    });

    return wss;
  }

  private authenticate(url: string): void {
    const parsed = new URL(url, "http://localhost");
    const token = parsed.searchParams.get("token") ?? parsed.searchParams.get("apiKey");
    if (!token) {
      // Allow anonymous in development
      if (process.env.NODE_ENV === "production") {
        throw new Error("missing token");
      }
      return;
    }
    // Accept opaque API keys / JWT-like tokens — verify HMAC service tokens
    if (token.startsWith("rt_")) {
      const [prefix, payload, sig] = token.split(".");
      if (!prefix || !payload || !sig) throw new Error("bad token");
      const expected = createHmac("sha256", this.authSecret).update(`${prefix}.${payload}`).digest("base64url");
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("bad signature");
    }
  }

  private identityFromUrl(url: string): string | null {
    try {
      return new URL(url, "http://localhost").searchParams.get("identity");
    } catch {
      return null;
    }
  }

  private handleMessage(socket: WebSocket, state: ClientState, message: Record<string, unknown>): void {
    const type = String(message.type ?? "");

    if (type === "pong") {
      state.lastPong = Date.now();
      return;
    }

    if (type === "subscribe") {
      const channel = String(message.channel ?? "");
      if (!channel || channel.length > 200) {
        socket.send(JSON.stringify({ type: "error", message: "Invalid channel" }));
        return;
      }
      if (state.channels.size >= this.maxSubscriptions) {
        socket.send(JSON.stringify({ type: "error", message: "Max subscriptions reached" }));
        return;
      }
      state.channels.add(channel);
      let channelState = this.channels.get(channel);
      if (!channelState) {
        channelState = { members: new Set(), presence: new Map() };
        this.channels.set(channel, channelState);
      }
      channelState.members.add(state.id);
      channelState.presence.set(state.id, { identity: state.identity, ...state.presence });
      socket.send(JSON.stringify({ type: "subscribed", channel }));
      this.broadcast(channel, {
        type: "presence.join",
        channel,
        clientId: state.id,
        identity: state.identity,
      }, state.id);
      socket.send(
        JSON.stringify({
          type: "presence.list",
          channel,
          members: [...channelState.presence.entries()].map(([clientId, data]) => ({
            clientId,
            ...data,
          })),
        }),
      );
      return;
    }

    if (type === "unsubscribe") {
      const channel = String(message.channel ?? "");
      this.leaveChannel(socket, state, channel);
      socket.send(JSON.stringify({ type: "unsubscribed", channel }));
      return;
    }

    if (type === "publish") {
      const channel = String(message.channel ?? "");
      if (!state.channels.has(channel)) {
        socket.send(JSON.stringify({ type: "error", message: "Not subscribed" }));
        return;
      }
      this.broadcast(channel, {
        type: "event",
        channel,
        event: message.event ?? "message",
        data: message.data ?? {},
        from: state.id,
      });
      return;
    }

    if (type === "presence.update") {
      state.presence = {
        ...(typeof message.data === "object" && message.data ? (message.data as Record<string, unknown>) : {}),
      };
      for (const channel of state.channels) {
        const channelState = this.channels.get(channel);
        channelState?.presence.set(state.id, { identity: state.identity, ...state.presence });
        this.broadcast(channel, {
          type: "presence.update",
          channel,
          clientId: state.id,
          data: state.presence,
        }, state.id);
      }
      return;
    }

    if (type === "direct") {
      const target = String(message.target ?? "");
      for (const [peerSocket, peerState] of this.clients) {
        if (peerState.id === target && peerSocket.readyState === WebSocket.OPEN) {
          peerSocket.send(
            JSON.stringify({
              type: "direct",
              from: state.id,
              data: message.data ?? {},
            }),
          );
        }
      }
      return;
    }

    socket.send(JSON.stringify({ type: "error", message: `Unknown type: ${type}` }));
  }

  private leaveChannel(_socket: WebSocket, state: ClientState, channel: string): void {
    state.channels.delete(channel);
    const channelState = this.channels.get(channel);
    if (!channelState) return;
    channelState.members.delete(state.id);
    channelState.presence.delete(state.id);
    this.broadcast(channel, {
      type: "presence.leave",
      channel,
      clientId: state.id,
    });
    if (channelState.members.size === 0) this.channels.delete(channel);
  }

  private leaveAll(socket: WebSocket, state: ClientState): void {
    for (const channel of [...state.channels]) {
      this.leaveChannel(socket, state, channel);
    }
  }

  private broadcast(channel: string, payload: Record<string, unknown>, excludeId?: string): void {
    const raw = JSON.stringify(payload);
    for (const [socket, state] of this.clients) {
      if (excludeId && state.id === excludeId) continue;
      if (state.channels.has(channel) && socket.readyState === WebSocket.OPEN) {
        socket.send(raw);
      }
    }
  }
}
