import { z } from "zod";

/** Stable Gateway error codes (handoff §7). */
export const GATEWAY_ERROR_CODES = [
  "INVALID_REQUEST",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "ASSISTANT_NOT_FOUND",
  "MODEL_NOT_ALLOWED",
  "CONSENT_REQUIRED",
  "CONTEXT_TOO_LARGE",
  "RATE_LIMITED",
  "BUDGET_EXCEEDED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "CONTENT_REJECTED",
  "MALFORMED_PROVIDER_RESPONSE",
  "INTERNAL_ERROR",
  "PAYMENT_NOT_CONFIGURED",
  "PRODUCT_NOT_FOUND",
  "PURCHASE_FORBIDDEN",
  "CHECKOUT_CREATE_FAILED",
  "INVALID_REDIRECT",
] as const;

export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[number];

export const GatewayErrorBodySchema = z.object({
  error: z.object({
    code: z.enum(GATEWAY_ERROR_CODES),
    message: z.string(),
    requestId: z.string(),
    retryable: z.boolean(),
    retryAfterMs: z.number().int().nonnegative().optional(),
  }),
});
export type GatewayErrorBody = z.infer<typeof GatewayErrorBodySchema>;

/** Short-lived Application → Gateway service JWT claims (handoff §5). */
export const ServiceTokenClaimsSchema = z.object({
  iss: z.string().min(1),
  aud: z.string().min(1),
  sub: z.string().min(1),
  applicationId: z.string().min(1),
  environmentId: z.string().min(1),
  assistantIds: z.array(z.string().min(1)).min(1),
  requestId: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type ServiceTokenClaims = z.infer<typeof ServiceTokenClaimsSchema>;

export const ContextSourceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["page", "provided", "retrieval"]),
  trust: z.literal("untrusted"),
  title: z.string().max(200).optional(),
  content: z.string().max(20_000),
});
export type ContextSource = z.infer<typeof ContextSourceSchema>;

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().max(32_000),
});

export const ChatRequestSchema = z.object({
  version: z.literal(1),
  assistantId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  message: ChatMessageSchema.extend({ role: z.literal("user") }),
  locale: z.string().min(2).max(16).optional(),
  route: z
    .object({
      id: z.string().min(1),
      pathname: z.string().min(1),
    })
    .optional(),
  history: z.array(ChatMessageSchema).max(40).default([]),
  context: z
    .object({
      mode: z.enum(["page", "provided", "hybrid"]),
      sources: z.array(ContextSourceSchema).max(20),
    })
    .optional(),
  client: z
    .object({
      sessionId: z.string().min(1).max(128),
      timezone: z.string().min(1).max(64).optional(),
      subjectClass: z.enum(["anonymous", "authenticated"]).optional(),
      subjectHash: z.string().max(128).optional(),
    })
    .optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const CitationItemSchema = z.object({
  sourceId: z.string().min(1),
  title: z.string().optional(),
  url: z.string().optional(),
});

export const ActionRequestedSchema = z.object({
  actionId: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
  requiresConfirmation: z.boolean().default(true),
});

export const MessagePartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("markdown"), text: z.string() }),
  z.object({ type: z.literal("code"), language: z.string().optional(), text: z.string() }),
  z.object({ type: z.literal("json"), value: z.unknown() }),
  z.object({
    type: z.literal("table"),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.unknown())),
  }),
  z.object({ type: z.literal("citations"), items: z.array(CitationItemSchema) }),
  z.object({ type: z.literal("action"), action: ActionRequestedSchema }),
]);
export type MessagePart = z.infer<typeof MessagePartSchema>;

export const ChatResponseSchema = z.object({
  version: z.literal(1),
  requestId: z.string(),
  assistantId: z.string(),
  conversationId: z.string(),
  message: z.object({
    id: z.string(),
    role: z.literal("assistant"),
    parts: z.array(MessagePartSchema),
    createdAt: z.string(),
  }),
  usage: z.object({
    provider: z.enum(["openai", "gemini", "fake"]),
    model: z.string(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  finishReason: z.enum(["stop", "length", "content_filter", "error", "cancelled"]),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const StreamEventSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("response.started"),
    version: z.literal(1),
    requestId: z.string(),
    conversationId: z.string(),
    assistantId: z.string(),
  }),
  z.object({
    event: z.literal("response.delta"),
    version: z.literal(1),
    requestId: z.string(),
    conversationId: z.string(),
    delta: z.string(),
  }),
  z.object({
    event: z.literal("response.citation"),
    version: z.literal(1),
    requestId: z.string(),
    conversationId: z.string(),
    citation: CitationItemSchema,
  }),
  z.object({
    event: z.literal("response.action_requested"),
    version: z.literal(1),
    requestId: z.string(),
    conversationId: z.string(),
    action: ActionRequestedSchema,
  }),
  z.object({
    event: z.literal("response.completed"),
    version: z.literal(1),
    requestId: z.string(),
    conversationId: z.string(),
    message: ChatResponseSchema.shape.message,
    usage: ChatResponseSchema.shape.usage,
    finishReason: ChatResponseSchema.shape.finishReason,
  }),
  z.object({
    event: z.literal("response.error"),
    version: z.literal(1),
    requestId: z.string(),
    conversationId: z.string(),
    error: GatewayErrorBodySchema.shape.error,
  }),
]);
export type StreamEvent = z.infer<typeof StreamEventSchema>;

export const FeedbackRequestSchema = z.object({
  version: z.literal(1),
  assistantId: z.string().min(1),
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  rating: z.enum(["up", "down"]),
  reason: z.string().max(500).optional(),
  locale: z.string().max(16).optional(),
  requestId: z.string().min(1).optional(),
});
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

export const CompiledAssistantConfigSchema = z.object({
  version: z.literal(1),
  applicationId: z.string(),
  environmentId: z.string(),
  assistantId: z.string(),
  enabled: z.boolean(),
  provider: z.enum(["openai", "gemini", "fake"]),
  model: z.string(),
  credentialRef: z.string(),
  systemInstruction: z.string(),
  allowedLocales: z.array(z.string()).default(["en"]),
  contextPolicy: z.object({
    modes: z.array(z.enum(["page", "provided", "hybrid"])),
    maxCharacters: z.number().int().positive(),
    maxSources: z.number().int().positive(),
    allowProtectedRoutes: z.boolean(),
  }),
  generation: z.object({
    temperature: z.number().min(0).max(2),
    maxOutputTokens: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    streaming: z.boolean(),
  }),
  limits: z.object({
    requestsPerMinute: z.number().int().positive(),
    concurrentRequests: z.number().int().positive(),
    dailyRequests: z.number().int().positive().optional(),
    dailyInputTokens: z.number().int().positive().optional(),
    dailyOutputTokens: z.number().int().positive().optional(),
  }),
  response: z.object({
    allowedPartTypes: z.array(
      z.enum(["text", "markdown", "code", "json", "table", "citations", "action"]),
    ),
    allowActions: z.array(z.string()),
  }),
  privacy: z.object({
    logContent: z.boolean(),
    persistConversation: z.boolean(),
    retentionDays: z.number().int().positive().optional(),
  }),
  configVersion: z.string().default("1"),
});
export type CompiledAssistantConfig = z.infer<typeof CompiledAssistantConfigSchema>;

export const CompiledActionConfigSchema = z.object({
  version: z.literal(1),
  actionId: z.string(),
  applicationId: z.string(),
  enabled: z.boolean(),
  auth: z.object({
    requireAuthenticated: z.boolean(),
    roles: z.array(z.string()).default([]),
  }),
  allowedRoutes: z.array(z.string()).default(["*"]),
  allowedEnvironments: z.array(z.string()).default(["*"]),
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  queryKind: z.enum(["parameterized", "repository"]),
  readOnly: z.boolean().default(true),
  requiresConfirmation: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(10_000),
  maxRows: z.number().int().positive().default(100),
  maxBytes: z.number().int().positive().default(65_536),
  redactFields: z.array(z.string()).default([]),
  auditClassification: z.enum(["low", "medium", "high"]).default("medium"),
});
export type CompiledActionConfig = z.infer<typeof CompiledActionConfigSchema>;

export const ActionInvokeRequestSchema = z.object({
  version: z.literal(1),
  input: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().min(8).max(128).optional(),
  confirmed: z.boolean().optional(),
  routeId: z.string().optional(),
});
export type ActionInvokeRequest = z.infer<typeof ActionInvokeRequestSchema>;

export const PaymentCheckoutRequestSchema = z.object({
  version: z.literal(1),
  paymentConfigId: z.string().min(1),
  productId: z.string().min(1),
  quantity: z.number().int().positive().max(100).default(1),
  successRouteId: z.string().min(1),
  cancelRouteId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(128),
});
export type PaymentCheckoutRequest = z.infer<typeof PaymentCheckoutRequestSchema>;

export const PaymentCheckoutResponseSchema = z.object({
  version: z.literal(1),
  checkoutId: z.string(),
  redirectUrl: z.string().url(),
  expiresAt: z.string(),
});
export type PaymentCheckoutResponse = z.infer<typeof PaymentCheckoutResponseSchema>;

export const PaymentStatusSchema = z.enum([
  "pending",
  "requires_action",
  "paid",
  "failed",
  "expired",
  "cancelled",
  "refunded",
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export function sanitizeUntrustedText(input: string, maxChars: number): string {
  const cleaned = input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, maxChars);
}

export function enforceContextLimits(
  sources: ContextSource[],
  maxSources: number,
  maxCharacters: number,
): { sources: ContextSource[]; truncated: boolean } {
  let truncated = sources.length > maxSources;
  const limited = sources.slice(0, maxSources).map((s) => ({
    ...s,
    content: sanitizeUntrustedText(s.content, Math.min(20_000, maxCharacters)),
  }));
  let total = 0;
  const out: ContextSource[] = [];
  for (const source of limited) {
    const remaining = maxCharacters - total;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (source.content.length > remaining) {
      out.push({ ...source, content: source.content.slice(0, remaining) });
      total = maxCharacters;
      truncated = true;
      break;
    }
    out.push(source);
    total += source.content.length;
  }
  return { sources: out, truncated };
}
