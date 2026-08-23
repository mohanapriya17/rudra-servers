import {
  enforceContextLimits,
  type ChatRequest,
  type ChatResponse,
  type CompiledAssistantConfig,
  type MessagePart,
  type StreamEvent,
  StreamEventSchema,
} from "@rudra/ai-contracts";
import { randomUUID } from "node:crypto";

export interface NormalizedMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface NormalizedRequest {
  model: string;
  systemInstruction: string;
  messages: NormalizedMessage[];
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface ProviderCitation {
  sourceId: string;
  title?: string;
  url?: string;
}

export interface ProviderAction {
  actionId: string;
  input?: Record<string, unknown>;
  requiresConfirmation?: boolean;
}

export interface ProviderResult {
  text: string;
  citations?: ProviderCitation[];
  actions?: ProviderAction[];
  usage: {
    provider: "openai" | "gemini" | "fake";
    model: string;
    inputTokens: number;
    outputTokens: number;
  };
  finishReason: ChatResponse["finishReason"];
}

export interface AiProviderAdapter {
  readonly provider: "openai" | "gemini" | "fake";
  complete(request: NormalizedRequest): Promise<ProviderResult>;
  stream(request: NormalizedRequest): AsyncGenerator<string, ProviderResult, void>;
}

export function buildNormalizedRequest(
  config: CompiledAssistantConfig,
  request: ChatRequest,
): NormalizedRequest {
  const contextSources = request.context?.sources ?? [];
  const { sources } = enforceContextLimits(
    contextSources,
    config.contextPolicy.maxSources,
    config.contextPolicy.maxCharacters,
  );

  const contextBlock =
    sources.length > 0
      ? `\n\nContext:\n${sources
          .map((source) => `[${source.id}] ${source.title ?? source.kind}: ${source.content}`)
          .join("\n")}`
      : "";

  const messages: NormalizedMessage[] = [
    ...request.history.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    {
      role: "user" as const,
      content: `${request.message.content}${contextBlock}`,
    },
  ];

  return {
    model: config.model,
    systemInstruction: config.systemInstruction,
    messages,
    temperature: config.generation.temperature,
    maxOutputTokens: Math.min(config.generation.maxOutputTokens, 2048),
    timeoutMs: config.generation.timeoutMs,
  };
}

export function responseToParts(
  result: ProviderResult,
  config: CompiledAssistantConfig,
): MessagePart[] {
  const parts: MessagePart[] = [];
  const allowed = new Set(config.response.allowedPartTypes);

  if (result.text && allowed.has("text")) {
    parts.push({ type: "text", text: result.text });
  } else if (result.text && allowed.has("markdown")) {
    parts.push({ type: "markdown", text: result.text });
  }

  if (result.citations?.length && allowed.has("citations")) {
    parts.push({
      type: "citations",
      items: result.citations.map((citation) => ({
        sourceId: citation.sourceId,
        ...(citation.title ? { title: citation.title } : {}),
        ...(citation.url ? { url: citation.url } : {}),
      })),
    });
  }

  for (const action of result.actions ?? []) {
    if (!allowed.has("action")) continue;
    if (!config.response.allowActions.includes(action.actionId)) continue;
    parts.push({
      type: "action",
      action: {
        actionId: action.actionId,
        input: action.input ?? {},
        requiresConfirmation: action.requiresConfirmation ?? true,
      },
    });
  }

  if (parts.length === 0 && result.text) {
    parts.push({ type: "text", text: result.text });
  }

  return parts;
}

export function buildChatResponse(
  request: ChatRequest,
  config: CompiledAssistantConfig,
  result: ProviderResult,
  requestId: string,
  conversationId: string,
): ChatResponse {
  return {
    version: 1,
    requestId,
    assistantId: config.assistantId,
    conversationId,
    message: {
      id: randomUUID(),
      role: "assistant",
      parts: responseToParts(result, config),
      createdAt: new Date().toISOString(),
    },
    usage: result.usage,
    finishReason: result.finishReason,
  };
}

export function toStreamEvents(
  response: ChatResponse,
  deltas: string[] = [],
): StreamEvent[] {
  const events: StreamEvent[] = [
    {
      event: "response.started",
      version: 1,
      requestId: response.requestId,
      conversationId: response.conversationId,
      assistantId: response.assistantId,
    },
  ];

  for (const delta of deltas) {
    events.push({
      event: "response.delta",
      version: 1,
      requestId: response.requestId,
      conversationId: response.conversationId,
      delta,
    });
  }

  for (const part of response.message.parts) {
    if (part.type === "citations") {
      for (const citation of part.items) {
        events.push({
          event: "response.citation",
          version: 1,
          requestId: response.requestId,
          conversationId: response.conversationId,
          citation,
        });
      }
    }
    if (part.type === "action") {
      events.push({
        event: "response.action_requested",
        version: 1,
        requestId: response.requestId,
        conversationId: response.conversationId,
        action: part.action,
      });
    }
  }

  events.push({
    event: "response.completed",
    version: 1,
    requestId: response.requestId,
    conversationId: response.conversationId,
    message: response.message,
    usage: response.usage,
    finishReason: response.finishReason,
  });

  for (const event of events) {
    StreamEventSchema.parse(event);
  }

  return events;
}
