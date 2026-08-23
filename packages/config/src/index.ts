import { z } from "zod";

export const SERVICE_PORTS = {
  "control-plane-api": 4000,
  "postgres-api": 4001,
  "mongodb-api": 4002,
  "graphql-api": 4003,
  "realtime-api": 4004,
  "webrtc-api": 4005,
  "file-api": 4006,
  "function-api": 4007,
  "pdf-generator-api": 4008,
  "ai-gateway-api": 4009,
} as const;

export type ServiceName = keyof typeof SERVICE_PORTS;

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export interface ServiceConfig {
  service: ServiceName;
  nodeEnv: "development" | "test" | "production";
  host: string;
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

export function loadServiceConfig(
  service: ServiceName,
  env: NodeJS.ProcessEnv = process.env,
): ServiceConfig {
  const parsed = baseSchema.parse(env);
  const portEnvKey = `${service.replace(/-/g, "_").toUpperCase()}_PORT`;
  const portRaw = env.PORT ?? env[portEnvKey] ?? String(SERVICE_PORTS[service]);
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid port for ${service}: ${portRaw}`);
  }

  return {
    service,
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port,
    logLevel: parsed.LOG_LEVEL,
  };
}

export const controlPlaneEnvSchema = z.object({
  CONTROL_PLANE_DATABASE_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  SECRETS_ENCRYPTION_KEY: z.string().min(16).default("dev-only-change-me-32chars-min!!"),
  JWT_SECRET: z.string().min(8).default("dev-jwt-secret-change-me"),
});

export function loadControlPlaneEnv(env: NodeJS.ProcessEnv = process.env) {
  const parsed = controlPlaneEnvSchema.parse(env);
  return {
    databaseUrl: parsed.CONTROL_PLANE_DATABASE_URL ?? parsed.DATABASE_URL,
    secretsEncryptionKey: parsed.SECRETS_ENCRYPTION_KEY,
    jwtSecret: parsed.JWT_SECRET,
  };
}
