export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|api[_-]?key|credential|cookie|jwt|private[_-]?key/i;

export interface LoggerOptions {
  service: string;
  level?: LogLevel;
}

export interface LogFields {
  requestId?: string;
  applicationId?: string;
  environmentId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  [key: string]: unknown;
}

export interface Logger {
  child(fields: LogFields): Logger;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[Truncated]";
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(nested, depth + 1);
    }
    return out;
  }
  return value;
}

class JsonLogger implements Logger {
  constructor(
    private readonly service: string,
    private readonly level: LogLevel,
    private readonly base: LogFields = {},
  ) {}

  child(fields: LogFields): Logger {
    return new JsonLogger(this.service, this.level, { ...this.base, ...fields });
  }

  debug(message: string, fields?: LogFields): void {
    this.write("debug", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.write("info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.write("warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.write("error", message, fields);
  }

  private write(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const payload = {
      level,
      time: new Date().toISOString(),
      service: this.service,
      message,
      ...(redact({ ...this.base, ...(fields ?? {}) }) as LogFields),
    };
    const line = JSON.stringify(payload);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }
}

export function createLogger(options: LoggerOptions): Logger {
  return new JsonLogger(options.service, options.level ?? "info");
}
