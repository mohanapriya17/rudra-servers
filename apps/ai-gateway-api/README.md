# AI Gateway API

Server-to-server AI gateway for Rudra applications. Accepts short-lived service JWTs from the protective layer and routes chat requests to configured assistants and model providers.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service health |
| `GET` | `/health/live` | Liveness probe |
| `GET` | `/health/ready` | Readiness probe |
| `GET` | `/ready` | Readiness alias |
| `GET` | `/metrics` | In-process request metrics |
| `POST` | `/v1/chat` | Non-streaming chat completion |
| `POST` | `/v1/chat/stream` | SSE streaming chat |
| `POST` | `/v1/feedback` | Message feedback |

Browser requests with an `Origin` header are rejected. Authenticate with `Authorization: Bearer <service-jwt>`.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RUDRA_AI_GATEWAY_ENV` | `development` | Runtime environment |
| `RUDRA_AI_GATEWAY_PORT` | `4009` | HTTP listen port |
| `RUDRA_AI_GATEWAY_HOST` | `0.0.0.0` | HTTP listen host |
| `RUDRA_AI_GATEWAY_ISSUER` | `https://ai.rudra.example` | Expected JWT `iss` |
| `RUDRA_AI_GATEWAY_AUDIENCE` | `rudra-ai-gateway` | Expected JWT `aud` |
| `RUDRA_AI_GATEWAY_SIGNING_SECRET` | dev default | HS256 signing secret (min 16 chars) |
| `OPENAI_API_KEY` | — | OpenAI provider API key |
| `GEMINI_API_KEY` | — | Gemini provider API key |
| `AI_DEFAULT_TIMEOUT_MS` | `30000` | Default upstream timeout |
| `AI_MAX_REQUEST_BYTES` | `131072` | JSON body size limit |
| `AI_MAX_CONTEXT_CHARACTERS` | `60000` | Context character ceiling |
| `AI_MAX_OUTPUT_TOKENS` | `2048` | Output token ceiling |
| `AI_RATE_LIMIT_PER_MINUTE` | `30` | Global fallback rate limit |
| `AI_LOG_CONTENT` | `false` | Log message content when `true` |
| `LOG_LEVEL` | `info` | Log level |

## Development

```bash
pnpm --filter @rudra/ai-gateway-api dev
curl http://localhost:4009/health
```

Built-in dev assistants (`app_demo`, `development`, `support`) use the deterministic `fake` provider.

## Contracts

Request/response and stream event shapes are defined in `@rudra/ai-contracts`. Service tokens must include `assistantIds` and expire within 60 seconds.
