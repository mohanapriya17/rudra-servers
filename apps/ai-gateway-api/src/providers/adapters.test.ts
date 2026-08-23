import { describe, expect, it } from "vitest";
import { StreamEventSchema } from "@rudra/ai-contracts";
import { fakeProviderAdapter } from "./fake.js";
import {
  buildChatResponse,
  buildNormalizedRequest,
  toStreamEvents,
} from "./types.js";
import { defaultDevAssistants } from "../assistants/store.js";

describe("provider adapters", () => {
  const assistant = defaultDevAssistants()[0]!;

  it("fake adapter returns deterministic output and stream events", async () => {
    const request = {
      version: 1 as const,
      assistantId: assistant.assistantId,
      conversationId: "conv-1",
      message: { id: "m1", role: "user" as const, content: "Hello there" },
      history: [],
    };
    const normalized = buildNormalizedRequest(assistant, request);
    const result = await fakeProviderAdapter.complete(normalized);
    expect(result.text).toContain("Fake assistant response");
    expect(result.usage.provider).toBe("fake");

    const response = buildChatResponse(request, assistant, result, "req-1", "conv-1");
    const deltas: string[] = [];
    const stream = fakeProviderAdapter.stream(normalized);
    let next = await stream.next();
    while (!next.done) {
      deltas.push(next.value);
      next = await stream.next();
    }

    const events = toStreamEvents(response, deltas);
    expect(events.at(-1)?.event).toBe("response.completed");
    for (const event of events) {
      expect(() => StreamEventSchema.parse(event)).not.toThrow();
    }
  });
});
