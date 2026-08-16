# Function / Action API

Trusted/admin-created functions for business logic escape hatches.

**Not a secure sandbox for hostile user code.** Execution is pluggable for future isolation.

## Features

- Function definitions
- `POST /api/v1/functions/:id/invoke`
- Webhook trigger
- Context: `input`, `secrets`, `fetch`, `postgres`, `mongodb`, `files`, `logger`
- Timeouts

## Setup

```bash
pnpm --filter @rudra/function-api start
```

Port: `4007`

Example handler:

```js
async function handler(ctx) {
  return { total: Number(ctx.input.qty) * Number(ctx.input.unit) };
}
```
