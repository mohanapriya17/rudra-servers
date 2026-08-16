# Postman collections

Import these into Postman (or Insomnia / Hoppscotch with Postman import):

| File | Purpose |
|------|---------|
| `Rudra-Backend.postman_collection.json` | All HTTP APIs across Rudra services |
| `Rudra-Local.postman_environment.json` | Local base URLs + DB connection strings |

## Import

1. Postman → **Import** → select both JSON files.
2. Select environment **Rudra Local**.
3. Start the services you want to hit (`pnpm --filter @rudra/<app> start`).
4. Optional deps: `docker compose -f docker/docker-compose.yml up -d`.

## Coverage

- Health / ready for all 8 apps
- Control Plane (apps, envs, secrets, datasources, resources, fields, indexes, relations, API keys)
- PostgreSQL Data API (datasources, schema DDL, CRUD, query, aggregate, bulk, upsert, transactions)
- MongoDB Data API (datasources, schema, indexes, CRUD, query, aggregate, bulk)
- GraphQL (schema management + `/graphql` execution)
- File API (upload-url → complete → download-url)
- Realtime (token mint; WS documented)
- WebRTC (rooms, join, TURN; signaling WS documented)
- Function API (create, invoke, webhook)

Create requests save IDs into **collection variables** (`appId`, `pgRowId`, `fileId`, etc.) so later requests can chain.

## Regenerate

```bash
node scripts/generate-postman-collection.mjs
```
