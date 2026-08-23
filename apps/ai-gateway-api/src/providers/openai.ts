import { GatewayHttpError } from "../errors.js";
import type { AiProviderAdapter, NormalizedRequest, ProviderResult } from "./types.js";

interface OpenAiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function createOpenAiAdapter(apiKey: string | undefined): AiProviderAdapter {
  if (!apiKey) {
    throw new GatewayHttpError("PROVIDER_UNAVAILABLE", "OpenAI provider is not configured.", 503, {
      retryable: true,
    });
  }

  async function callOpenAi(request: NormalizedRequest): Promise<ProviderResult> {
    const messages: OpenAiMessage[] = [
      { role: "system", content: request.systemInstruction },
      ...request.messages,
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          messages,
          temperature: request.temperature,
          max_tokens: request.maxOutputTokens,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new GatewayHttpError("PROVIDER_UNAVAILABLE", "OpenAI request failed.", 502, {
          retryable: response.status >= 500,
        });
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = body.choices?.[0];
      const text = choice?.message?.content ?? "";
      if (!text) {
        throw new GatewayHttpError("MALFORMED_PROVIDER_RESPONSE", "OpenAI returned empty content.", 502);
      }

      return {
        text,
        usage: {
          provider: "openai",
          model: request.model,
          inputTokens: body.usage?.prompt_tokens ?? estimateTokens(messages.map((m) => m.content).join("\n")),
          outputTokens: body.usage?.completion_tokens ?? estimateTokens(text),
        },
        finishReason: choice?.finish_reason === "length" ? "length" : "stop",
      };
    } catch (error) {
      if (error instanceof GatewayHttpError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new GatewayHttpError("PROVIDER_TIMEOUT", "OpenAI request timed out.", 504, { retryable: true });
      }
      throw new GatewayHttpError("PROVIDER_UNAVAILABLE", "OpenAI request failed.", 502, {
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    provider: "openai",
    complete: callOpenAi,
    async *stream(request: NormalizedRequest): AsyncGenerator<string, ProviderResult, void> {
      const result = await callOpenAi(request);
      const chunks = result.text.match(/.{1,24}/g) ?? [result.text];
      for (const chunk of chunks) {
        yield chunk;
      }
      return result;
    },
  };
}
