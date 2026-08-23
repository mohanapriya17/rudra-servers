import { GatewayHttpError } from "../errors.js";
import type { AiProviderAdapter, NormalizedRequest, ProviderResult } from "./types.js";

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function createGeminiAdapter(apiKey: string | undefined): AiProviderAdapter {
  if (!apiKey) {
    throw new GatewayHttpError("PROVIDER_UNAVAILABLE", "Gemini provider is not configured.", 503, {
      retryable: true,
    });
  }
  const resolvedApiKey = apiKey;

  async function callGemini(request: NormalizedRequest): Promise<ProviderResult> {
    const contents = request.messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(resolvedApiKey)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.systemInstruction }] },
          contents,
          generationConfig: {
            temperature: request.temperature,
            maxOutputTokens: request.maxOutputTokens,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new GatewayHttpError("PROVIDER_UNAVAILABLE", "Gemini request failed.", 502, {
          retryable: response.status >= 500,
        });
      }

      const body = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          finishReason?: string;
        }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const parts = body.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((part) => part.text ?? "").join("");
      if (!text) {
        throw new GatewayHttpError("MALFORMED_PROVIDER_RESPONSE", "Gemini returned empty content.", 502);
      }

      const finishReason = body.candidates?.[0]?.finishReason;
      return {
        text,
        usage: {
          provider: "gemini",
          model: request.model,
          inputTokens:
            body.usageMetadata?.promptTokenCount ??
            estimateTokens(`${request.systemInstruction}\n${request.messages.map((m) => m.content).join("\n")}`),
          outputTokens: body.usageMetadata?.candidatesTokenCount ?? estimateTokens(text),
        },
        finishReason: finishReason === "MAX_TOKENS" ? "length" : "stop",
      };
    } catch (error) {
      if (error instanceof GatewayHttpError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new GatewayHttpError("PROVIDER_TIMEOUT", "Gemini request timed out.", 504, { retryable: true });
      }
      throw new GatewayHttpError("PROVIDER_UNAVAILABLE", "Gemini request failed.", 502, {
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    provider: "gemini",
    complete: callGemini,
    async *stream(request: NormalizedRequest): AsyncGenerator<string, ProviderResult, void> {
      const result = await callGemini(request);
      const chunks = result.text.match(/.{1,24}/g) ?? [result.text];
      for (const chunk of chunks) {
        yield chunk;
      }
      return result;
    },
  };
}
