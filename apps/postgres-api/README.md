# PostgreSQL Data API

Generic PostgreSQL REST API for Rudra applications.

Base URL: `/api/v1/postgres`

GraphQL is **not** implemented here — use `graphql-api`.

## Features (Phase 2)

- Data source registration (connection string never returned)
- Dynamic resource/table creation with physical schema mapping
- Field add / constrained alter / delete (`confirm=true`)
- Indexes (`btree`, `hash`, `gin`, `gist`, `brin`)
- Foreign key relations
- CRUD + pagination/sort
- Structured query filters (no raw SQL)
- Aggregations (`count`, `sum`, `avg`, `min`, `max`, `groupBy`)
- Bulk create/update/delete (max 500)
- Upsert
- Multi-operation transactions (no raw SQL)

## Safety

Resource names from URLs are **never** interpolated into SQL.

```text
logical: projects
physical: rudra_app_xxx.resource_f8d812
```

Identifiers are validated and quoted. Values are parameterized.

## Setup

```bash
pnpm install
pnpm --filter @rudra/postgres-api build
POSTGRES_API_PORT=4001 pnpm --filter @rudra/postgres-api start
```

## Environment

| Variable | Description |
|----------|-------------|
| `PORT` / `POSTGRES_API_PORT` | Listen port (default `4001`) |
| `HOST` | Bind address |
| `LOG_LEVEL` | Log verbosity |
| `POSTGRES_METADATA_URL` | Postgres URL for persisting datasource/resource registry (recommended on Render). Uses schema `rudra_meta`. Can be the same Neon DB as your app data. |
| `POSTGRES_METADATA_ENCRYPTION_KEY` | AES key material (≥16 chars) used to encrypt stored connection strings. Falls back to `SECRETS_ENCRYPTION_KEY`. |
| `SECRET_<id>` | Optional secret resolution for `connectionSecretId` |

Without `POSTGRES_METADATA_URL`, the registry stays **in-memory** and is wiped on every restart.

## Quick example

```bash
# Register datasource
curl -X POST http://localhost:4001/api/v1/postgres/datasources \
  -H 'content-type: application/json' \
  -d '{"name":"main","connectionString":"postgres://rudra:rudra@127.0.0.1:5432/rudra_data","ssl":false}'

# Create table
curl -X POST http://localhost:4001/api/v1/postgres/main/resources \
  -H 'content-type: application/json' \
  -d '{
    "name":"projects",
    "fields":[
      {"name":"id","type":"uuid","primaryKey":true,"default":"uuid"},
      {"name":"name","type":"varchar","length":255,"nullable":false},
      {"name":"status","type":"text","default":"ACTIVE"},
      {"name":"budget","type":"numeric","precision":12,"scale":2},
      {"name":"createdAt","type":"timestamptz","default":"now"}
    ]
  }'

# Insert
curl -X POST http://localhost:4001/api/v1/postgres/main/data/projects \
  -H 'content-type: application/json' \
  -d '{"name":"Website Redesign","status":"ACTIVE","budget":100000}'

# Query
curl -X POST http://localhost:4001/api/v1/postgres/main/data/projects/query \
  -H 'content-type: application/json' \
  -d '{"where":{"status":{"eq":"ACTIVE"},"budget":{"gte":10000}},"limit":20}'
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/datasources` | Register DB connection |
| GET | `/datasources` | List datasources |
| POST | `/:source/resources` | Create table |
| POST | `/:source/resources/:resource/fields` | Add column |
| PATCH | `/:source/resources/:resource/fields/:field` | Alter column (safe ops) |
| DELETE | `/:source/resources/:resource/fields/:field?confirm=true` | Drop column |
| POST | `/:source/resources/:resource/indexes` | Create index |
| POST | `/:source/resources/:resource/relations` | Add FK |
| GET/POST/PATCH/DELETE | `/:source/data/:resource...` | CRUD |
| POST | `/:source/data/:resource/query` | Structured query |
| POST/PATCH/DELETE | `/:source/data/:resource/bulk` | Bulk ops |
| POST | `/:source/data/:resource/upsert` | Upsert |
| POST | `/:source/transaction` | Atomic ops |

## Deployment

Deploy as `rudra-postgres-api` on Render. Pair with `control-plane-api` for application metadata when needed.
