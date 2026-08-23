import { randomUUID } from "node:crypto";
import {
  ChatRequestSchema,
  type ChatRequest,
  type ChatResponse,
  type StreamEvent,
} from "@rudra/ai-contracts";
import { RudraError } from "@rudra/errors";
import { MemoryRateLimiter } from "@rudra/rate-limit";
import { mintGatewayServiceToken } from "../auth/service-token.js";
import type { SessionClaims } from "../auth/session.js";

export interface AiChatForwarderOptions {
  gatewayBaseUrl: string;
  signingSecret: string;
  issuer: string;
  audience: string;
  applicationId: string;
  environmentId: string;
  assistantIds: string[];
  rateLimiter?: MemoryRateLimiter;
  fetchImpl?: typeof fetch;
}

const SENSITIVE_RESPONSE_KEYS = /secret|token|authorization|api[_-]?key|password|credential/i;

function stripSecrets<T>(value: T): T {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => stripSecrets(item)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_RESPONSE_KEYS.test(key) ? "[REDACTED]" : stripSecrets(nested);
  }
  return out as T;
}

export function createAiChatForwarder(options: AiChatForwarderOptions) {
  const limiter = options.rateLimiter ?? new MemoryRateLimiter({ windowMs: 60_000, max: 60 });
  const fetchImpl = options.fetchImpl ?? fetch;

  function mintToken(session: SessionClaims, requestId: string): string {
    return mintGatewayServiceToken({
      secret: options.signingSecret,
      issuer: options.issuer,
      audience: options.audience,
      sub: session.sub,
      applicationId: options.applicationId,
      environmentId: options.environmentId,
      assistantIds: options.assistantIds,
      requestId,
    });
  }

  async function forward(path: "/v1/chat" | "/v1/chat/stream", body: ChatRequest, session: SessionClaims) {
    const parsed = ChatRequestSchema.parse(body);
    if (!options.assistantIds.includes(parsed.assistantId)) {
      throw new RudraError("FORBIDDEN", "Assistant is not enabled for this application");
    }

    limiter.consume(`${session.sessionId}:${parsed.assistantId}`);
    const requestId = randomUUID();
    const token = mintToken(session, requestId);
    const response = await fetchImpl(`${options.gatewayBaseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-request-id": requestId,
      },
      body: JSON.stringify(parsed),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new RudraError("SERVICE_UNAVAILABLE", errorBody?.error?.message ?? "AI gateway request failed", {
        status: response.status,
      });
    }

    return stripSecrets(await response.json());
  }

  return {
    async chat(body: ChatRequest, session: SessionClaims): Promise<ChatResponse> {
      return (await forward("/v1/chat", body, session)) as ChatResponse;
    },
    async stream(body: ChatRequest, session: SessionClaims): Promise<Response> {
      const parsed = ChatRequestSchema.parse(body);
      if (!options.assistantIds.includes(parsed.assistantId)) {
        throw new RudraError("FORBIDDEN", "Assistant is not enabled for this application");
      }
      limiter.consume(`${session.sessionId}:${parsed.assistantId}`);
      const requestId = randomUUID();
      const token = mintToken(session, requestId);
      return fetchImpl(`${options.gatewayBaseUrl}/v1/chat/stream`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-request-id": requestId,
        },
        body: JSON.stringify(parsed),
      });
    },
    parseStreamEvent(line: string): StreamEvent | null {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return null;
      const payload = trimmed.slice(5).trim();
      if (!payload) return null;
      return JSON.parse(payload) as StreamEvent;
    },
  };
}
