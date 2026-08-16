# GraphQL API

Dynamic GraphQL server with configurable schemas and multi-source resolvers.

- Endpoint: `POST /graphql`
- Management: `/api/v1/graphql/*`

## Resolver types

`postgres` · `mongodb` · `rest` · `function` · `static` · `parent`

Postgres/Mongo resolvers call the shared data APIs (or configured endpoints) — they do not embed GraphQL inside `postgres-api`.

## Protections

- Query depth limit
- Query complexity limit
- SSRF allowlist for REST resolvers
- Configurable introspection

## Setup

```bash
pnpm --filter @rudra/graphql-api start
```

Port: `4003`

Wire upstreams:

```bash
GRAPHQL_PG_main=http://localhost:4001/api/v1/postgres/main
GRAPHQL_MONGO_main=http://localhost:4002/api/v1/mongodb/main
FUNCTION_API_URL=http://localhost:4007
GRAPHQL_REST_ALLOWLIST=*
```
