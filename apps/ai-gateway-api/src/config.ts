import { z } from "zod";

const envSchema = z.object({
  RUDRA_AI_GATEWAY_ENV: z.enum(["development", "test", "production"]).default("development"),
  RUDRA_AI_GATEWAY_PORT: z.coerce.number().int().positive().default(4009),
  RUDRA_AI_GATEWAY_HOST: z.string().default("0.0.0.0"),
  RUDRA_AI_GATEWAY_ISSUER: z.string().default("https://ai.rudra.example"),
  RUDRA_AI_GATEWAY_AUDIENCE: z.string().default("rudra-ai-gateway"),
  RUDRA_AI_GATEWAY_SIGNING_SECRET: z.string().min(16).default("dev-only-ai-gateway-signing-secret!!"),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  AI_DEFAULT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  AI_MAX_REQUEST_BYTES: z.coerce.number().int().positive().default(131_072),
  AI_MAX_CONTEXT_CHARACTERS: z.coerce.number().int().positive().default(60_000),
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(2048),
  AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
  AI_LOG_CONTENT: z.string().optional().transform((v) => v === "true"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type GatewayConfig = z.infer<typeof envSchema> & {
  port: number;
  host: string;
  logContent: boolean;
};

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const parsed = envSchema.parse(env);
  return {
    ...parsed,
    port: parsed.RUDRA_AI_GATEWAY_PORT,
    host: parsed.RUDRA_AI_GATEWAY_HOST,
    logContent: Boolean(parsed.AI_LOG_CONTENT),
  };
}
