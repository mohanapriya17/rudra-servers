import { createHash } from "node:crypto";
import type { AiProviderAdapter, NormalizedRequest, ProviderResult } from "./types.js";

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function deterministicReply(request: NormalizedRequest): string {
  const seed = createHash("sha256")
    .update(
      JSON.stringify({
        system: request.systemInstruction,
        messages: request.messages,
        model: request.model,
      }),
    )
    .digest("hex")
    .slice(0, 8);
  const lastUser = [...request.messages].reverse().find((message) => message.role === "user");
  return `Fake assistant response (${seed}): ${lastUser?.content ?? "Hello"}`;
}

export const fakeProviderAdapter: AiProviderAdapter = {
  provider: "fake",

  async complete(request: NormalizedRequest): Promise<ProviderResult> {
    const text = deterministicReply(request);
    const inputTokens = estimateTokens(
      `${request.systemInstruction}\n${request.messages.map((m) => m.content).join("\n")}`,
    );
    return {
      text,
      usage: {
        provider: "fake",
        model: request.model,
        inputTokens,
        outputTokens: estimateTokens(text),
      },
      finishReason: "stop",
    };
  },

  async *stream(request: NormalizedRequest): AsyncGenerator<string, ProviderResult, void> {
    const text = deterministicReply(request);
    const chunks = text.match(/.{1,12}/g) ?? [text];
    for (const chunk of chunks) {
      yield chunk;
    }
    const inputTokens = estimateTokens(
      `${request.systemInstruction}\n${request.messages.map((m) => m.content).join("\n")}`,
    );
    return {
      text,
      usage: {
        provider: "fake",
        model: request.model,
        inputTokens,
        outputTokens: estimateTokens(text),
      },
      finishReason: "stop",
    };
  },
};
