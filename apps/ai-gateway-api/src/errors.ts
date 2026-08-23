import type { GatewayErrorCode } from "@rudra/ai-contracts";

export class GatewayHttpError extends Error {
  readonly code: GatewayErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(
    code: GatewayErrorCode,
    message: string,
    status: number,
    options?: { retryable?: boolean; retryAfterMs?: number; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "GatewayHttpError";
    this.code = code;
    this.status = status;
    this.retryable = options?.retryable ?? false;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export function toGatewayErrorBody(error: unknown, requestId: string) {
  if (error instanceof GatewayHttpError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        requestId,
        retryable: error.retryable,
        ...(error.retryAfterMs != null ? { retryAfterMs: error.retryAfterMs } : {}),
      },
    };
  }
  return {
    error: {
      code: "INTERNAL_ERROR" as const,
      message: "The assistant is temporarily unavailable.",
      requestId,
      retryable: true,
    },
  };
}
