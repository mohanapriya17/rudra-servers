export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "RESOURCE_NOT_FOUND"
  | "DATASOURCE_NOT_FOUND"
  | "APPLICATION_NOT_FOUND"
  | "ENVIRONMENT_NOT_FOUND"
  | "SECRET_NOT_FOUND"
  | "API_KEY_NOT_FOUND"
  | "INVALID_API_KEY"
  | "UNSUPPORTED_OPERATION";

export class RudraError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { status?: number; details?: unknown; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "RudraError";
    this.code = code;
    this.status = options?.status ?? statusForCode(code);
    this.details = options?.details;
  }
}

export function statusForCode(code: ErrorCode): number {
  switch (code) {
    case "BAD_REQUEST":
    case "VALIDATION_ERROR":
    case "UNSUPPORTED_OPERATION":
      return 400;
    case "UNAUTHORIZED":
    case "INVALID_API_KEY":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
    case "RESOURCE_NOT_FOUND":
    case "DATASOURCE_NOT_FOUND":
    case "APPLICATION_NOT_FOUND":
    case "ENVIRONMENT_NOT_FOUND":
    case "SECRET_NOT_FOUND":
    case "API_KEY_NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "SERVICE_UNAVAILABLE":
      return 503;
    default:
      return 500;
  }
}

export function isRudraError(error: unknown): error is RudraError {
  return error instanceof RudraError;
}

export function toErrorBody(
  error: unknown,
  requestId: string,
): { error: { code: string; message: string; requestId: string; details?: unknown } } {
  if (isRudraError(error)) {
    return {
      error: {
        code: error.code,
        message: error.message,
        requestId,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    };
  }

  return {
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      requestId,
    },
  };
}
