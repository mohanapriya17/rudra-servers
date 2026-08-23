import { randomUUID } from "node:crypto";
import {
  ChatRequestSchema,
  enforceContextLimits,
  FeedbackRequestSchema,
  type ChatRequest,
  type ServiceTokenClaims,
} from "@rudra/ai-contracts";
import type { Logger } from "@rudra/logging";
import type { GatewayConfig } from "../config.js";
import { GatewayHttpError } from "../errors.js";
import {
  ConcurrentLimiter,
  consumeOrThrow,
  createAssistantRateLimiter,
} from "../limits.js";
import type { AssistantStore } from "../assistants/store.js";
import type { GatewayMetrics } from "../observability/metrics.js";
import { createGeminiAdapter } from "../providers/gemini.js";
import { fakeProviderAdapter } from "../providers/fake.js";
import { createOpenAiAdapter } from "../providers/openai.js";
import {
  buildChatResponse,
  buildNormalizedRequest,
  toStreamEvents,
  type AiProviderAdapter,
} from "../providers/types.js";

class DailyRequestCounter {
  private readonly counts = new Map<string, { day: string; count: number }>();

  consume(key: string, max: number): void {
    const day = new Date().toISOString().slice(0, 10);
    const existing = this.counts.get(key);
    if (!existing || existing.day !== day) {
      this.counts.set(key, { day, count: 1 });
      return;
    }
    if (existing.count >= max) {
      throw new GatewayHttpError("BUDGET_EXCEEDED", "Daily request budget exceeded.", 429, {
        retryable: true,
        retryAfterMs: 86_400_000,
      });
    }
    existing.count += 1;
  }
}

export interface ChatServiceOptions {
  config: GatewayConfig;
  store: AssistantStore;
  metrics: GatewayMetrics;
  logger?: Logger;
}

export class ChatService {
  private readonly rateLimiters = new Map<string, ReturnType<typeof createAssistantRateLimiter>>();
  private readonly concurrentLimiters = new Map<string, ConcurrentLimiter>();
  private readonly dailyCounters = new DailyRequestCounter();

  constructor(private readonly options: ChatServiceOptions) {}

  private getRateLimiter(assistantId: string, max: number) {
    const existing = this.rateLimiters.get(assistantId);
    if (existing) return existing;
    const limiter = createAssistantRateLimiter(max);
    this.rateLimiters.set(assistantId, limiter);
    return limiter;
  }

  private getConcurrentLimiter(assistantId: string, max: number) {
    const existing = this.concurrentLimiters.get(assistantId);
    if (existing) return existing;
    const limiter = new ConcurrentLimiter(max);
    this.concurrentLimiters.set(assistantId, limiter);
    return limiter;
  }

  private resolveAdapter(provider: "openai" | "gemini" | "fake"): AiProviderAdapter {
    switch (provider) {
      case "fake":
        return fakeProviderAdapter;
      case "openai":
        return createOpenAiAdapter(this.options.config.OPENAI_API_KEY);
      case "gemini":
        return createGeminiAdapter(this.options.config.GEMINI_API_KEY);
      default:
        throw new GatewayHttpError("PROVIDER_UNAVAILABLE", "Unsupported provider.", 503);
    }
  }

  private validateRequest(request: ChatRequest, claims: ServiceTokenClaims) {
    if (!claims.assistantIds.includes(request.assistantId)) {
      throw new GatewayHttpError("FORBIDDEN", "Assistant is not authorized for this token.", 403);
    }

    const assistant = this.options.store.get(request.assistantId);
    if (!assistant) {
      throw new GatewayHttpError("ASSISTANT_NOT_FOUND", "Assistant not found.", 404);
    }
    if (!assistant.enabled) {
      throw new GatewayHttpError("ASSISTANT_NOT_FOUND", "Assistant is disabled.", 404);
    }
    if (
      assistant.applicationId !== claims.applicationId ||
      assistant.environmentId !== claims.environmentId
    ) {
      throw new GatewayHttpError("FORBIDDEN", "Assistant environment mismatch.", 403);
    }

    if (request.locale && !assistant.allowedLocales.includes(request.locale)) {
      throw new GatewayHttpError("INVALID_REQUEST", "Locale is not allowed for this assistant.", 400);
    }

    if (request.context) {
      if (!assistant.contextPolicy.modes.includes(request.context.mode)) {
        throw new GatewayHttpError("INVALID_REQUEST", "Context mode is not allowed.", 400);
      }
      if (request.route && !assistant.contextPolicy.allowProtectedRoutes) {
        throw new GatewayHttpError("FORBIDDEN", "Protected routes are not allowed.", 403);
      }
      const { truncated } = enforceContextLimits(
        request.context.sources,
        assistant.contextPolicy.maxSources,
        assistant.contextPolicy.maxCharacters,
      );
      if (truncated) {
        this.options.logger?.warn("context truncated", { assistantId: assistant.assistantId });
      }
    }

    return assistant;
  }

  private acquireLimits(assistantId: string, limits: {
    requestsPerMinute: number;
    concurrentRequests: number;
    dailyRequests?: number;
  }) {
    consumeOrThrow(this.getRateLimiter(assistantId, limits.requestsPerMinute), assistantId);
    if (limits.dailyRequests) {
      this.dailyCounters.consume(assistantId, limits.dailyRequests);
    }
    return this.getConcurrentLimiter(assistantId, limits.concurrentRequests).acquire(assistantId);
  }

  async complete(rawBody: unknown, claims: ServiceTokenClaims) {
    const parsed = this.parseBody(rawBody);
    const assistant = this.validateRequest(parsed, claims);
    const release = this.acquireLimits(assistant.assistantId, assistant.limits);
    this.options.metrics.recordRequest(false);

    try {
      const adapter = this.resolveAdapter(assistant.provider);
      const normalized = buildNormalizedRequest(assistant, parsed);
      const result = await adapter.complete(normalized);
      const conversationId = parsed.conversationId ?? randomUUID();
      const response = buildChatResponse(parsed, assistant, result, claims.requestId, conversationId);
      this.options.metrics.success({
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
      return response;
    } catch (error) {
      this.recordError(error);
      throw error;
    } finally {
      release();
    }
  }

  async *stream(rawBody: unknown, claims: ServiceTokenClaims) {
    const parsed = this.parseBody(rawBody);
    const assistant = this.validateRequest(parsed, claims);
    if (!assistant.generation.streaming) {
      throw new GatewayHttpError("INVALID_REQUEST", "Streaming is disabled for this assistant.", 400);
    }

    const release = this.acquireLimits(assistant.assistantId, assistant.limits);
    this.options.metrics.recordRequest(true);
    this.options.metrics.beginStream();

    try {
      const adapter = this.resolveAdapter(assistant.provider);
      const normalized = buildNormalizedRequest(assistant, parsed);
      const conversationId = parsed.conversationId ?? randomUUID();
      const deltas: string[] = [];
      const generator = adapter.stream(normalized);
      let next = await generator.next();
      while (!next.done) {
        deltas.push(next.value);
        yield {
          event: "response.delta" as const,
          version: 1 as const,
          requestId: claims.requestId,
          conversationId,
          delta: next.value,
        };
        next = await generator.next();
      }

      const result = next.value;
      const response = buildChatResponse(parsed, assistant, result, claims.requestId, conversationId);
      const events = toStreamEvents(response, deltas);
      for (const event of events) {
        if (event.event === "response.delta") continue;
        yield event;
      }
      this.options.metrics.success({
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
    } catch (error) {
      this.recordError(error);
      throw error;
    } finally {
      release();
      this.options.metrics.endStream();
    }
  }

  recordFeedback(rawBody: unknown, claims: ServiceTokenClaims) {
    let parsed;
    try {
      parsed = FeedbackRequestSchema.parse(rawBody);
    } catch {
      throw new GatewayHttpError("INVALID_REQUEST", "Invalid feedback payload.", 400);
    }
    if (!claims.assistantIds.includes(parsed.assistantId)) {
      throw new GatewayHttpError("FORBIDDEN", "Assistant is not authorized for this token.", 403);
    }
    this.options.logger?.info("feedback recorded", {
      assistantId: parsed.assistantId,
      conversationId: parsed.conversationId,
      messageId: parsed.messageId,
      rating: parsed.rating,
      requestId: claims.requestId,
    });
    return { accepted: true };
  }

  private parseBody(rawBody: unknown): ChatRequest {
    try {
      return ChatRequestSchema.parse(rawBody);
    } catch {
      throw new GatewayHttpError("INVALID_REQUEST", "Invalid chat request.", 400);
    }
  }

  private recordError(error: unknown) {
    if (error instanceof GatewayHttpError) {
      this.options.metrics.reject(error.code);
    } else {
      this.options.metrics.reject("INTERNAL_ERROR");
    }
  }
}
