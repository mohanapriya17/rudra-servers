# MongoDB Data API

Generic MongoDB REST API for Rudra applications.

Base URL: `/api/v1/mongodb`

## Features (Phase 3)

- Data source registration (connection strings never returned)
- Collection creation with optional JSON-schema validators
- Nested object / array schemas
- Indexes (single, compound, unique, text, TTL, 2d/2dsphere, sparse, partial)
- CRUD + pagination/sort
- Structured query API (no raw Mongo operators from clients)
- Controlled aggregation (`match`, `group`, `sort`, `limit`, `skip`, `project`, `unwind`, `lookup`, `count`)
- Bulk create/update/delete (max 500)

## Safety

- Logical resource names map to physical collections (`resource_*`)
- User queries cannot include `$where`, `$function`, or other dangerous operators
- Aggregation stages are allowlisted and sanitized

## Setup

```bash
pnpm install
pnpm --filter @rudra/mongodb-api build
MONGODB_API_PORT=4002 pnpm --filter @rudra/mongodb-api start
```

## Example

```bash
curl -X POST http://localhost:4002/api/v1/mongodb/datasources \
  -H 'content-type: application/json' \
  -d '{"name":"main","connectionString":"mongodb://127.0.0.1:27017","database":"rudra"}'

curl -X POST http://localhost:4002/api/v1/mongodb/main/resources \
  -H 'content-type: application/json' \
  -d '{
    "name":"messages",
    "schema":{
      "senderId":{"type":"objectId","required":true},
      "message":{"type":"string","required":true},
      "createdAt":{"type":"date"}
    }
  }'

curl -X POST http://localhost:4002/api/v1/mongodb/main/data/messages \
  -H 'content-type: application/json' \
  -d '{"senderId":"507f1f77bcf86cd799439011","message":"hello"}'

curl -X POST http://localhost:4002/api/v1/mongodb/main/data/messages/query \
  -H 'content-type: application/json' \
  -d '{"where":{"status":{"eq":"active"}},"limit":20}'
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/datasources` | Register connection |
| POST | `/:source/resources` | Create collection |
| PUT | `/:source/resources/:resource/schema` | Update validator |
| POST | `/:source/resources/:resource/indexes` | Create index |
| GET/POST/PATCH/DELETE | `/:source/data/:resource...` | CRUD |
| POST | `/:source/data/:resource/query` | Structured query |
| POST | `/:source/data/:resource/aggregate` | Controlled aggregation |
| POST/PATCH/DELETE | `/:source/data/:resource/bulk` | Bulk ops |

## Deployment

Deploy as `rudra-mongodb-api` on Render. Compatible with MongoDB Atlas or any standard MongoDB deployment — no Atlas-specific behavior.
