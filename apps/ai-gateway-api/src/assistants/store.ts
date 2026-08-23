import type { CompiledAssistantConfig } from "@rudra/ai-contracts";

export interface AssistantStore {
  get(assistantId: string): CompiledAssistantConfig | undefined;
  list(): CompiledAssistantConfig[];
  upsert(config: CompiledAssistantConfig): void;
}

function baseAssistant(
  assistantId: string,
  overrides: Partial<CompiledAssistantConfig> = {},
): CompiledAssistantConfig {
  return {
    version: 1,
    applicationId: "app_demo",
    environmentId: "development",
    assistantId,
    enabled: true,
    provider: "fake",
    model: "fake-v1",
    credentialRef: "fake/default",
    systemInstruction: `You are the ${assistantId} assistant for Rudra demo applications.`,
    allowedLocales: ["en", "en-US"],
    contextPolicy: {
      modes: ["page", "provided", "hybrid"],
      maxCharacters: 12_000,
      maxSources: 10,
      allowProtectedRoutes: false,
    },
    generation: {
      temperature: 0.2,
      maxOutputTokens: 1024,
      timeoutMs: 15_000,
      streaming: true,
    },
    limits: {
      requestsPerMinute: 60,
      concurrentRequests: 4,
      dailyRequests: 500,
    },
    response: {
      allowedPartTypes: ["text", "markdown", "code", "json", "citations", "action"],
      allowActions: ["search_docs", "create_ticket"],
    },
    privacy: {
      logContent: false,
      persistConversation: false,
    },
    configVersion: "1",
    ...overrides,
  };
}

export function defaultDevAssistants(): CompiledAssistantConfig[] {
  return [
    baseAssistant("app_demo", {
      systemInstruction: "You are the app demo assistant. Be concise and helpful.",
    }),
    baseAssistant("development", {
      systemInstruction: "You are the development assistant for engineers building on Rudra.",
      response: {
        allowedPartTypes: ["text", "markdown", "code"],
        allowActions: [],
      },
    }),
    baseAssistant("support", {
      systemInstruction: "You are the support assistant. Offer clear troubleshooting steps.",
      response: {
        allowedPartTypes: ["text", "markdown", "citations", "action"],
        allowActions: ["create_ticket"],
      },
    }),
  ];
}

export class MemoryAssistantStore implements AssistantStore {
  private readonly byId = new Map<string, CompiledAssistantConfig>();

  constructor(seed: CompiledAssistantConfig[] = defaultDevAssistants()) {
    for (const config of seed) {
      this.byId.set(config.assistantId, config);
    }
  }

  get(assistantId: string): CompiledAssistantConfig | undefined {
    return this.byId.get(assistantId);
  }

  list(): CompiledAssistantConfig[] {
    return [...this.byId.values()];
  }

  upsert(config: CompiledAssistantConfig): void {
    this.byId.set(config.assistantId, config);
  }
}
