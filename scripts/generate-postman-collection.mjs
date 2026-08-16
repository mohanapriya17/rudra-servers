#!/usr/bin/env node
/**
 * Generates postman/Rudra-Backend.postman_collection.json
 * and postman/Rudra-Local.postman_environment.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "postman");
mkdirSync(outDir, { recursive: true });

const uid = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

function headerJson() {
  return [
    { key: "Content-Type", value: "application/json" },
    { key: "Accept", value: "application/json" },
    { key: "X-Request-Id", value: "{{$guid}}" },
  ];
}

function url(raw) {
  const withoutQuery = raw.split("?")[0];
  const queryPart = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : "";
  const path = withoutQuery.replace(/\{\{([^}]+)\}\}/g, (_, name) => `{{${name}}}`);
  const hostMatch = path.match(/^\{\{([^}]+)\}\}(.*)$/);
  const hostVar = hostMatch ? hostMatch[1] : "controlPlaneUrl";
  const pathRest = hostMatch ? hostMatch[2] : path;
  const segments = pathRest.split("/").filter(Boolean);
  const query = queryPart
    ? queryPart.split("&").map((pair) => {
        const [key, ...rest] = pair.split("=");
        return { key, value: rest.join("="), disabled: false };
      })
    : [];
  return {
    raw,
    host: [`{{${hostVar}}}`],
    path: segments,
    ...(query.length ? { query } : {}),
  };
}

function req(name, method, rawUrl, opts = {}) {
  const item = {
    name,
    request: {
      method,
      header: opts.noJsonHeader ? [{ key: "Accept", value: "application/json" }] : headerJson(),
      url: url(rawUrl),
      description: opts.description ?? "",
    },
    response: [],
  };
  if (opts.body !== undefined) {
    item.request.body = {
      mode: "raw",
      raw: typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body, null, 2),
      options: { raw: { language: "json" } },
    };
  }
  if (opts.tests) {
    item.event = [
      {
        listen: "test",
        script: {
          type: "text/javascript",
          exec: opts.tests.split("\n"),
        },
      },
    ];
  }
  return item;
}

function folder(name, description, items) {
  return {
    name,
    description,
    item: items,
  };
}

function saveId(varName, path = "data.id") {
  return [
    `pm.test("status is success", function () {`,
    `  pm.expect(pm.response.code).to.be.oneOf([200, 201, 204]);`,
    `});`,
    `if (pm.response.code !== 204) {`,
    `  try {`,
    `    const json = pm.response.json();`,
    `    const value = ${path.split(".").reduce((acc, key) => `${acc}?.${key}`, "json")};`,
    `    if (value != null) {`,
    `      pm.collectionVariables.set("${varName}", value);`,
    `      console.log("Saved ${varName}=" + value);`,
    `    }`,
    `  } catch (e) {}`,
    `}`,
  ].join("\n");
}

function statusOk() {
  return [
    `pm.test("status is success", function () {`,
    `  pm.expect(pm.response.code).to.be.oneOf([200, 201, 204]);`,
    `});`,
  ].join("\n");
}

const collection = {
  info: {
    _postman_id: uid(),
    name: "Rudra Backend Platform",
    description: [
      "Complete HTTP collection for the Rudra headless backend monorepo.",
      "",
      "## Services",
      "| Service | Default port | Base path |",
      "|---------|--------------|-----------|",
      "| Control Plane | 4000 | `/api/v1` |",
      "| PostgreSQL API | 4001 | `/api/v1/postgres` |",
      "| MongoDB API | 4002 | `/api/v1/mongodb` |",
      "| GraphQL API | 4003 | `/api/v1/graphql` + `/graphql` |",
      "| Realtime API | 4004 | `/api/v1/realtime` (+ WS `/ws`, `/yjs/:id`) |",
      "| WebRTC API | 4005 | `/api/v1/webrtc` (+ WS `/ws`) |",
      "| File API | 4006 | `/api/v1/files` |",
      "| Function API | 4007 | `/api/v1/functions` |",
      "",
      "## Setup",
      "1. Import this collection and `Rudra-Local.postman_environment.json`.",
      "2. Select the **Rudra Local** environment.",
      "3. Start services (`pnpm --filter @rudra/<app> start`) and optional `docker compose -f docker/docker-compose.yml up -d`.",
      "4. Run folders in order where noted (Control Plane → Postgres/Mongo → GraphQL).",
      "",
      "Successful create requests write IDs into collection variables automatically.",
      "",
      "## WebSockets",
      "Realtime (`ws://localhost:4004/ws`, `/yjs/:documentId`) and WebRTC signaling (`ws://localhost:4005/ws`)",
      "are documented under those folders but require a WebSocket client (Postman WS, wscat, or a browser).",
    ].join("\n"),
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  variable: [
    { key: "controlPlaneUrl", value: "http://localhost:4000" },
    { key: "postgresUrl", value: "http://localhost:4001" },
    { key: "mongodbUrl", value: "http://localhost:4002" },
    { key: "graphqlUrl", value: "http://localhost:4003" },
    { key: "realtimeUrl", value: "http://localhost:4004" },
    { key: "webrtcUrl", value: "http://localhost:4005" },
    { key: "fileUrl", value: "http://localhost:4006" },
    { key: "functionUrl", value: "http://localhost:4007" },
    { key: "postgresConnectionString", value: "postgres://rudra:rudra@localhost:5432/rudra" },
    { key: "mongodbConnectionString", value: "mongodb://localhost:27017/rudra" },
    { key: "appId", value: "" },
    { key: "environmentId", value: "" },
    { key: "secretId", value: "" },
    { key: "dataSourceId", value: "" },
    { key: "resourceId", value: "" },
    { key: "fieldId", value: "" },
    { key: "apiKeyId", value: "" },
    { key: "apiKey", value: "" },
    { key: "pgSource", value: "main" },
    { key: "pgResource", value: "projects" },
    { key: "pgRowId", value: "" },
    { key: "mongoSource", value: "main" },
    { key: "mongoResource", value: "messages" },
    { key: "mongoDocId", value: "" },
    { key: "graphqlSchemaId", value: "" },
    { key: "graphqlSchemaName", value: "application-api" },
    { key: "fileId", value: "" },
    { key: "functionId", value: "" },
    { key: "functionName", value: "hello" },
    { key: "webrtcRoomId", value: "" },
    { key: "webrtcToken", value: "" },
    { key: "webrtcPeerId", value: "" },
    { key: "realtimeToken", value: "" },
  ],
  item: [
    folder("00 Health & Ready", "Health and readiness probes for every service.", [
      req("Control Plane — Health", "GET", "{{controlPlaneUrl}}/health", { noJsonHeader: true, tests: statusOk() }),
      req("Control Plane — Ready", "GET", "{{controlPlaneUrl}}/ready", { noJsonHeader: true, tests: statusOk() }),
      req("Postgres — Health", "GET", "{{postgresUrl}}/health", { noJsonHeader: true, tests: statusOk() }),
      req("Postgres — Ready", "GET", "{{postgresUrl}}/ready", { noJsonHeader: true, tests: statusOk() }),
      req("MongoDB — Health", "GET", "{{mongodbUrl}}/health", { noJsonHeader: true, tests: statusOk() }),
      req("MongoDB — Ready", "GET", "{{mongodbUrl}}/ready", { noJsonHeader: true, tests: statusOk() }),
      req("GraphQL — Health", "GET", "{{graphqlUrl}}/health", { noJsonHeader: true, tests: statusOk() }),
      req("GraphQL — Ready", "GET", "{{graphqlUrl}}/ready", { noJsonHeader: true, tests: statusOk() }),
      req("Realtime — Health", "GET", "{{realtimeUrl}}/health", { noJsonHeader: true, tests: statusOk() }),
      req("Realtime — Ready", "GET", "{{realtimeUrl}}/ready", { noJsonHeader: true, tests: statusOk() }),
      req("WebRTC — Health", "GET", "{{webrtcUrl}}/health", { noJsonHeader: true, tests: statusOk() }),
      req("WebRTC — Ready", "GET", "{{webrtcUrl}}/ready", { noJsonHeader: true, tests: statusOk() }),
      req("File — Health", "GET", "{{fileUrl}}/health", { noJsonHeader: true, tests: statusOk() }),
      req("File — Ready", "GET", "{{fileUrl}}/ready", { noJsonHeader: true, tests: statusOk() }),
      req("Function — Health", "GET", "{{functionUrl}}/health", { noJsonHeader: true, tests: statusOk() }),
      req("Function — Ready", "GET", "{{functionUrl}}/ready", { noJsonHeader: true, tests: statusOk() }),
    ]),

    folder(
      "01 Control Plane",
      "Apps, environments, secrets, datasources, resources, fields, indexes, relations, API keys.\nBase: `{{controlPlaneUrl}}/api/v1`",
      [
        folder("Apps", "", [
          req("Create App", "POST", "{{controlPlaneUrl}}/api/v1/apps", {
            body: { name: "Demo Application", slug: "demo-app", metadata: { owner: "postman" } },
            tests: saveId("appId"),
          }),
          req("List Apps", "GET", "{{controlPlaneUrl}}/api/v1/apps", { noJsonHeader: true, tests: statusOk() }),
          req("Get App", "GET", "{{controlPlaneUrl}}/api/v1/apps/{{appId}}", { noJsonHeader: true, tests: statusOk() }),
          req("Update App", "PATCH", "{{controlPlaneUrl}}/api/v1/apps/{{appId}}", {
            body: { name: "Demo Application Updated", metadata: { owner: "postman", tier: "dev" } },
            tests: statusOk(),
          }),
          req("Delete App", "DELETE", "{{controlPlaneUrl}}/api/v1/apps/{{appId}}", {
            noJsonHeader: true,
            description: "Destructive — run last if you need the app for other requests.",
            tests: statusOk(),
          }),
        ]),
        folder("Environments", "", [
          req("Create Environment", "POST", "{{controlPlaneUrl}}/api/v1/apps/{{appId}}/environments", {
            body: { name: "development", slug: "development" },
            tests: saveId("environmentId"),
          }),
          req("List Environments", "GET", "{{controlPlaneUrl}}/api/v1/apps/{{appId}}/environments", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
        ]),
        folder("Secrets", "Plaintext values are never returned after create.", [
          req("Create Secret", "POST", "{{controlPlaneUrl}}/api/v1/secrets", {
            body: {
              name: "DATABASE_URL",
              value: "postgres://rudra:rudra@localhost:5432/rudra",
              environmentId: "{{environmentId}}",
              applicationId: "{{appId}}",
            },
            tests: saveId("secretId"),
          }),
          req("List Secrets", "GET", "{{controlPlaneUrl}}/api/v1/secrets?environmentId={{environmentId}}&applicationId={{appId}}", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
          req("Get Secret Meta", "GET", "{{controlPlaneUrl}}/api/v1/secrets/{{secretId}}", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
        ]),
        folder("Data Sources", "", [
          req("Create Data Source", "POST", "{{controlPlaneUrl}}/api/v1/datasources", {
            body: {
              applicationId: "{{appId}}",
              environmentId: "{{environmentId}}",
              name: "main-db",
              type: "postgres",
              connectionSecretId: "{{secretId}}",
              ssl: false,
            },
            tests: saveId("dataSourceId"),
          }),
          req("List Data Sources", "GET", "{{controlPlaneUrl}}/api/v1/datasources?applicationId={{appId}}&environmentId={{environmentId}}", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
          req("Get Data Source", "GET", "{{controlPlaneUrl}}/api/v1/datasources/{{dataSourceId}}", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
        ]),
        folder("Resources & Metadata", "", [
          req("Create Resource", "POST", "{{controlPlaneUrl}}/api/v1/resources", {
            body: { dataSourceId: "{{dataSourceId}}", name: "projects", kind: "table" },
            tests: saveId("resourceId"),
          }),
          req("List Resources", "GET", "{{controlPlaneUrl}}/api/v1/datasources/{{dataSourceId}}/resources", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
          req("Get Resource", "GET", "{{controlPlaneUrl}}/api/v1/resources/{{resourceId}}", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
          req("Create Field", "POST", "{{controlPlaneUrl}}/api/v1/resources/{{resourceId}}/fields", {
            body: { name: "name", type: "varchar", length: 255, nullable: false },
            tests: saveId("fieldId"),
          }),
          req("List Fields", "GET", "{{controlPlaneUrl}}/api/v1/resources/{{resourceId}}/fields", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
          req("Update Field", "PATCH", "{{controlPlaneUrl}}/api/v1/resources/{{resourceId}}/fields/{{fieldId}}", {
            body: { nullable: true },
            tests: statusOk(),
          }),
          req("Create Index", "POST", "{{controlPlaneUrl}}/api/v1/resources/{{resourceId}}/indexes", {
            body: { name: "projects_name_idx", type: "btree", fields: ["name"], unique: false },
            tests: statusOk(),
          }),
          req("List Indexes", "GET", "{{controlPlaneUrl}}/api/v1/resources/{{resourceId}}/indexes", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
          req("Create Relation", "POST", "{{controlPlaneUrl}}/api/v1/resources/{{resourceId}}/relations", {
            body: {
              field: "clientId",
              references: { resource: "clients", field: "id" },
              onDelete: "cascade",
            },
            tests: statusOk(),
          }),
          req("List Relations", "GET", "{{controlPlaneUrl}}/api/v1/resources/{{resourceId}}/relations", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
          req("Delete Field", "DELETE", "{{controlPlaneUrl}}/api/v1/resources/{{resourceId}}/fields/{{fieldId}}?confirm=true", {
            noJsonHeader: true,
            description: "Requires confirm=true",
            tests: statusOk(),
          }),
        ]),
        folder("API Keys", "", [
          req("Create API Key", "POST", "{{controlPlaneUrl}}/api/v1/api-keys", {
            body: {
              applicationId: "{{appId}}",
              environmentId: "{{environmentId}}",
              name: "postman",
              scopes: ["read", "write"],
            },
            tests: [
              saveId("apiKeyId"),
              `try {`,
              `  const json = pm.response.json();`,
              `  if (json?.data?.key) pm.collectionVariables.set("apiKey", json.data.key);`,
              `} catch (e) {}`,
            ].join("\n"),
          }),
          req("List API Keys", "GET", "{{controlPlaneUrl}}/api/v1/api-keys?applicationId={{appId}}&environmentId={{environmentId}}", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
          req("Revoke API Key", "POST", "{{controlPlaneUrl}}/api/v1/api-keys/{{apiKeyId}}/revoke", {
            body: {},
            tests: statusOk(),
          }),
        ]),
      ],
    ),

    folder(
      "02 PostgreSQL API",
      "Physical table mapping, DDL, CRUD, query, bulk, upsert, transactions.\nBase: `{{postgresUrl}}/api/v1/postgres`\nRequires Postgres (e.g. docker compose).",
      [
        folder("Data Sources", "", [
          req("Create Data Source", "POST", "{{postgresUrl}}/api/v1/postgres/datasources", {
            body: {
              name: "{{pgSource}}",
              connectionString: "{{postgresConnectionString}}",
              ssl: false,
            },
            tests: [
              statusOk(),
              `try {`,
              `  const json = pm.response.json();`,
              `  if (json?.data?.name) pm.collectionVariables.set("pgSource", json.data.name);`,
              `  if (json?.data?.id) pm.collectionVariables.set("pgSourceId", json.data.id);`,
              `} catch (e) {}`,
            ].join("\n"),
          }),
          req("List Data Sources", "GET", "{{postgresUrl}}/api/v1/postgres/datasources", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
          req("Get Data Source", "GET", "{{postgresUrl}}/api/v1/postgres/datasources/{{pgSource}}", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
        ]),
        folder("Schema / Resources", "", [
          req("Create Resource (clients)", "POST", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/resources", {
            body: {
              name: "clients",
              fields: [
                { name: "id", type: "uuid", primaryKey: true, nullable: false },
                { name: "email", type: "varchar", length: 255, unique: true, nullable: false },
                { name: "name", type: "varchar", length: 120, nullable: false },
              ],
            },
            tests: statusOk(),
          }),
          req("Create Resource (projects)", "POST", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/resources", {
            body: {
              name: "projects",
              fields: [
                { name: "id", type: "uuid", primaryKey: true, nullable: false },
                { name: "name", type: "varchar", length: 255, nullable: false },
                { name: "status", type: "varchar", length: 40, nullable: true, default: "active" },
                { name: "budget", type: "numeric", precision: 12, scale: 2, nullable: true },
                { name: "clientId", type: "uuid", nullable: true },
                { name: "createdAt", type: "timestamptz", nullable: false },
              ],
            },
            tests: [
              statusOk(),
              `pm.collectionVariables.set("pgResource", "projects");`,
            ].join("\n"),
          }),
          req("List Resources", "GET", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/resources", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
          req("Get Resource", "GET", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/resources/{{pgResource}}", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
          req("Add Field", "POST", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/resources/{{pgResource}}/fields", {
            body: { name: "description", type: "text", nullable: true },
            tests: statusOk(),
          }),
          req("Update Field (nullable)", "PATCH", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/resources/{{pgResource}}/fields/budget", {
            body: { nullable: true },
            tests: statusOk(),
          }),
          req("Create Index", "POST", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/resources/{{pgResource}}/indexes", {
            body: { name: "projects_status_idx", type: "btree", fields: ["status"] },
            tests: statusOk(),
          }),
          req("Create Relation", "POST", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/resources/{{pgResource}}/relations", {
            body: {
              field: "clientId",
              references: { resource: "clients", field: "id" },
              onDelete: "set null",
            },
            tests: statusOk(),
          }),
          req("Delete Field", "DELETE", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/resources/{{pgResource}}/fields/description?confirm=true", {
            noJsonHeader: true,
            description: "Requires confirm=true",
            tests: statusOk(),
          }),
        ]),
        folder("Data CRUD", "", [
          req("Create Client Row", "POST", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/data/clients", {
            body: {
              email: "alice@example.com",
              name: "Alice",
            },
            tests: [
              statusOk(),
              `try {`,
              `  const json = pm.response.json();`,
              `  if (json?.data?.id) pm.collectionVariables.set("pgClientId", json.data.id);`,
              `} catch (e) {}`,
            ].join("\n"),
          }),
          req("Create Project Row", "POST", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/data/{{pgResource}}", {
            body: {
              name: "Website Redesign",
              status: "active",
              budget: 12000,
              clientId: "{{pgClientId}}",
            },
            tests: saveId("pgRowId"),
          }),
          req("List Rows", "GET", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/data/{{pgResource}}?page=1&limit=20&sort=createdAt&order=desc", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
          req("Get Row", "GET", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/data/{{pgResource}}/{{pgRowId}}", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
          req("Update Row", "PATCH", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/data/{{pgResource}}/{{pgRowId}}", {
            body: { status: "paused", budget: 15000 },
            tests: statusOk(),
          }),
          req("Query Rows", "POST", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/data/{{pgResource}}/query", {
            body: {
              where: { status: { eq: "paused" } },
              orderBy: [{ field: "name", direction: "asc" }],
              limit: 20,
              offset: 0,
            },
            tests: statusOk(),
          }),
          req("Query Aggregate", "POST", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/data/{{pgResource}}/query", {
            body: {
              aggregate: { count: true, sum: ["budget"], avg: ["budget"], groupBy: ["status"] },
            },
            tests: statusOk(),
          }),
          req("Upsert Row", "POST", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/data/clients/upsert", {
            body: {
              conflictFields: ["email"],
              data: { email: "alice@example.com", name: "Alice Updated" },
              updateFields: ["name"],
            },
            tests: statusOk(),
          }),
          req("Bulk Create", "POST", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/data/{{pgResource}}/bulk", {
            body: {
              records: [
                { name: "Bulk A", status: "active", budget: 100 },
                { name: "Bulk B", status: "active", budget: 200 },
              ],
            },
            tests: statusOk(),
          }),
          req("Bulk Update", "PATCH", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/data/{{pgResource}}/bulk", {
            body: {
              records: [{ id: "{{pgRowId}}", data: { status: "active" } }],
            },
            tests: statusOk(),
          }),
          req("Transaction", "POST", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/transaction", {
            body: {
              operations: [
                {
                  operation: "create",
                  resource: "projects",
                  data: { name: "Tx Project", status: "active", budget: 50 },
                },
                {
                  operation: "update",
                  resource: "projects",
                  id: "{{pgRowId}}",
                  data: { status: "done" },
                },
              ],
            },
            tests: statusOk(),
          }),
          req("Bulk Delete", "DELETE", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/data/{{pgResource}}/bulk", {
            body: { ids: ["{{pgRowId}}"] },
            description: "Destructive — adjust IDs as needed.",
            tests: statusOk(),
          }),
          req("Delete Row", "DELETE", "{{postgresUrl}}/api/v1/postgres/{{pgSource}}/data/{{pgResource}}/{{pgRowId}}", {
            noJsonHeader: true,
            description: "May 404 if already bulk-deleted.",
            tests: statusOk(),
          }),
        ]),
      ],
    ),

    folder(
      "03 MongoDB API",
      "Collections, validators, CRUD, query, aggregation, bulk.\nBase: `{{mongodbUrl}}/api/v1/mongodb`",
      [
        folder("Data Sources", "", [
          req("Create Data Source", "POST", "{{mongodbUrl}}/api/v1/mongodb/datasources", {
            body: {
              name: "{{mongoSource}}",
              connectionString: "{{mongodbConnectionString}}",
              database: "rudra",
            },
            tests: [
              statusOk(),
              `try {`,
              `  const json = pm.response.json();`,
              `  if (json?.data?.name) pm.collectionVariables.set("mongoSource", json.data.name);`,
              `} catch (e) {}`,
            ].join("\n"),
          }),
          req("List Data Sources", "GET", "{{mongodbUrl}}/api/v1/mongodb/datasources", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
          req("Get Data Source", "GET", "{{mongodbUrl}}/api/v1/mongodb/datasources/{{mongoSource}}", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
        ]),
        folder("Resources", "", [
          req("Create Resource", "POST", "{{mongodbUrl}}/api/v1/mongodb/{{mongoSource}}/resources", {
            body: {
              name: "messages",
              validationLevel: "moderate",
              validationAction: "error",
              schema: {
                text: { type: "string", required: true },
                channel: { type: "string", required: true },
                score: { type: "int" },
                createdAt: { type: "date" },
              },
            },
            tests: [
              statusOk(),
              `pm.collectionVariables.set("mongoResource", "messages");`,
            ].join("\n"),
          }),
          req("List Resources", "GET", "{{mongodbUrl}}/api/v1/mongodb/{{mongoSource}}/resources", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
          req("Get Resource", "GET", "{{mongodbUrl}}/api/v1/mongodb/{{mongoSource}}/resources/{{mongoResource}}", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
          req("Update Schema", "PUT", "{{mongodbUrl}}/api/v1/mongodb/{{mongoSource}}/resources/{{mongoResource}}/schema", {
            body: {
              validationLevel: "moderate",
              validationAction: "warn",
              schema: {
                text: { type: "string", required: true },
                channel: { type: "string", required: true },
                score: { type: "int" },
                tags: { type: "array", items: { type: "string" } },
                createdAt: { type: "date" },
              },
            },
            tests: statusOk(),
          }),
          req("Create Index", "POST", "{{mongodbUrl}}/api/v1/mongodb/{{mongoSource}}/resources/{{mongoResource}}/indexes", {
            body: { name: "messages_channel_idx", fields: { channel: 1 }, unique: false },
            tests: statusOk(),
          }),
        ]),
        folder("Data CRUD", "", [
          req("Create Document", "POST", "{{mongodbUrl}}/api/v1/mongodb/{{mongoSource}}/data/{{mongoResource}}", {
            body: { text: "Hello Rudra", channel: "general", score: 10 },
            tests: [
              statusOk(),
              `try {`,
              `  const json = pm.response.json();`,
              `  const id = json?.data?.id ?? json?.data?._id;`,
              `  if (id) pm.collectionVariables.set("mongoDocId", id);`,
              `} catch (e) {}`,
            ].join("\n"),
          }),
          req("List Documents", "GET", "{{mongodbUrl}}/api/v1/mongodb/{{mongoSource}}/data/{{mongoResource}}?page=1&limit=20&sort=createdAt&order=desc", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
          req("Get Document", "GET", "{{mongodbUrl}}/api/v1/mongodb/{{mongoSource}}/data/{{mongoResource}}/{{mongoDocId}}", {
            noJsonHeader: true,
            tests: statusOk(),
          }),
          req("Update Document", "PATCH", "{{mongodbUrl}}/api/v1/mongodb/{{mongoSource}}/data/{{mongoResource}}/{{mongoDocId}}", {
            body: { score: 42, tags: ["postman"] },
            tests: statusOk(),
          }),
          req("Query Documents", "POST", "{{mongodbUrl}}/api/v1/mongodb/{{mongoSource}}/data/{{mongoResource}}/query", {
            body: {
              where: { channel: { eq: "general" } },
              sort: [{ field: "score", direction: "desc" }],
              limit: 20,
              skip: 0,
            },
            tests: statusOk(),
          }),
          req("Aggregate", "POST", "{{mongodbUrl}}/api/v1/mongodb/{{mongoSource}}/data/{{mongoResource}}/aggregate", {
            body: {
              stages: [
                { stage: "match", spec: { channel: "general" } },
                { stage: "group", spec: { _id: "$channel", total: { $sum: "$score" }, count: { $sum: 1 } } },
                { stage: "sort", spec: { count: -1 } },
                { stage: "limit", spec: 10 },
              ],
            },
            tests: statusOk(),
          }),
          req("Bulk Create", "POST", "{{mongodbUrl}}/api/v1/mongodb/{{mongoSource}}/data/{{mongoResource}}/bulk", {
            body: {
              records: [
                { text: "Bulk 1", channel: "ops", score: 1 },
                { text: "Bulk 2", channel: "ops", score: 2 },
              ],
            },
            tests: statusOk(),
          }),
          req("Bulk Update", "PATCH", "{{mongodbUrl}}/api/v1/mongodb/{{mongoSource}}/data/{{mongoResource}}/bulk", {
            body: {
              records: [{ id: "{{mongoDocId}}", data: { score: 99 } }],
            },
            tests: statusOk(),
          }),
          req("Bulk Delete", "DELETE", "{{mongodbUrl}}/api/v1/mongodb/{{mongoSource}}/data/{{mongoResource}}/bulk", {
            body: { ids: ["{{mongoDocId}}"] },
            tests: statusOk(),
          }),
          req("Delete Document", "DELETE", "{{mongodbUrl}}/api/v1/mongodb/{{mongoSource}}/data/{{mongoResource}}/{{mongoDocId}}", {
            noJsonHeader: true,
            description: "May 404 if already bulk-deleted.",
            tests: statusOk(),
          }),
        ]),
      ],
    ),

    folder(
      "04 GraphQL API",
      "Dynamic schema management + query execution.\nManagement: `{{graphqlUrl}}/api/v1/graphql`\nExecute: `POST {{graphqlUrl}}/graphql`",
      [
        req("Create Schema", "POST", "{{graphqlUrl}}/api/v1/graphql/schemas", {
          body: {
            name: "application-api",
            introspection: true,
            queryDepthLimit: 10,
            queryComplexityLimit: 1000,
            types: [
              {
                name: "Project",
                kind: "object",
                fields: [
                  { name: "id", type: "ID!", resolver: { type: "parent", field: "id" } },
                  { name: "name", type: "String!", resolver: { type: "parent", field: "name" } },
                  { name: "city", type: "String", resolver: { type: "parent", field: "city" } },
                ],
              },
            ],
            queries: [
              {
                name: "projects",
                type: "[Project!]!",
                resolver: {
                  type: "static",
                  value: [{ id: "1", name: "Website", city: "Austin" }],
                },
              },
              {
                name: "hello",
                type: "String!",
                resolver: { type: "static", value: "hello from rudra" },
              },
            ],
          },
          tests: [
            saveId("graphqlSchemaId"),
            `try {`,
            `  const json = pm.response.json();`,
            `  if (json?.data?.name) pm.collectionVariables.set("graphqlSchemaName", json.data.name);`,
            `} catch (e) {}`,
          ].join("\n"),
        }),
        req("List Schemas", "GET", "{{graphqlUrl}}/api/v1/graphql/schemas", {
          noJsonHeader: true,
          tests: statusOk(),
        }),
        req("Get Schema", "GET", "{{graphqlUrl}}/api/v1/graphql/schemas/{{graphqlSchemaName}}", {
          noJsonHeader: true,
          tests: statusOk(),
        }),
        req("Add Type", "POST", "{{graphqlUrl}}/api/v1/graphql/schemas/{{graphqlSchemaName}}/types", {
          body: {
            name: "Client",
            kind: "object",
            fields: [
              { name: "id", type: "ID!", resolver: { type: "parent", field: "id" } },
              { name: "email", type: "String!", resolver: { type: "parent", field: "email" } },
            ],
          },
          tests: statusOk(),
        }),
        req("Set Queries", "PUT", "{{graphqlUrl}}/api/v1/graphql/schemas/{{graphqlSchemaName}}/queries", {
          body: [
            {
              name: "projects",
              type: "[Project!]!",
              resolver: {
                type: "static",
                value: [{ id: "1", name: "Website", city: "Austin" }],
              },
            },
            {
              name: "hello",
              type: "String!",
              resolver: { type: "static", value: "hello from rudra" },
            },
            {
              name: "projectById",
              type: "Project",
              args: [{ name: "id", type: "ID!" }],
              resolver: {
                type: "postgres",
                dataSourceId: "main",
                resource: "projects",
                operation: "findOne",
                idArg: "id",
              },
            },
          ],
          tests: statusOk(),
        }),
        req("Set Mutations", "PUT", "{{graphqlUrl}}/api/v1/graphql/schemas/{{graphqlSchemaName}}/mutations", {
          body: [
            {
              name: "echo",
              type: "String!",
              args: [{ name: "message", type: "String!" }],
              resolver: { type: "function", functionId: "{{functionName}}" },
            },
          ],
          tests: statusOk(),
        }),
        req("Execute (schema path)", "POST", "{{graphqlUrl}}/api/v1/graphql/schemas/{{graphqlSchemaName}}/graphql", {
          body: {
            query: "{ hello projects { id name city } }",
          },
          tests: statusOk(),
        }),
        req("Execute (default /graphql)", "POST", "{{graphqlUrl}}/graphql?schema={{graphqlSchemaName}}", {
          body: {
            query: "query GetProjects { projects { id name } }",
            variables: {},
            operationName: "GetProjects",
          },
          tests: statusOk(),
        }),
        req("GraphQL Landing Page", "GET", "{{graphqlUrl}}/graphql", {
          noJsonHeader: true,
          tests: statusOk(),
        }),
      ],
    ),

    folder(
      "05 File API",
      "Presigned upload/download flow (S3/R2 or memory fallback).\nBase: `{{fileUrl}}/api/v1/files`",
      [
        req("Create Upload URL", "POST", "{{fileUrl}}/api/v1/files/upload-url", {
          body: {
            fileName: "demo.txt",
            mimeType: "text/plain",
            size: 12,
            visibility: "private",
            applicationId: "{{appId}}",
            environmentId: "{{environmentId}}",
            metadata: { source: "postman" },
          },
          tests: [
            statusOk(),
            `try {`,
            `  const json = pm.response.json();`,
            `  if (json?.data?.fileId) pm.collectionVariables.set("fileId", json.data.fileId);`,
            `} catch (e) {}`,
          ].join("\n"),
          description:
            "Response includes uploadUrl. For memory driver, PUT/POST the bytes to that URL (or skip and call complete).",
        }),
        req("Complete Upload", "POST", "{{fileUrl}}/api/v1/files/{{fileId}}/complete", {
          body: {},
          tests: statusOk(),
        }),
        req("Get Download URL", "GET", "{{fileUrl}}/api/v1/files/{{fileId}}/download-url", {
          noJsonHeader: true,
          tests: statusOk(),
        }),
        req("List Files", "GET", "{{fileUrl}}/api/v1/files?applicationId={{appId}}&environmentId={{environmentId}}", {
          noJsonHeader: true,
          tests: statusOk(),
        }),
        req("Get File Meta", "GET", "{{fileUrl}}/api/v1/files/{{fileId}}", {
          noJsonHeader: true,
          tests: statusOk(),
        }),
        req("Delete File", "DELETE", "{{fileUrl}}/api/v1/files/{{fileId}}", {
          noJsonHeader: true,
          tests: statusOk(),
        }),
      ],
    ),

    folder(
      "06 Realtime API",
      "HTTP token mint + WebSocket docs.\nWS: `ws://localhost:4004/ws`\nYjs: `ws://localhost:4004/yjs/:documentId`",
      [
        req("Create Realtime Token", "POST", "{{realtimeUrl}}/api/v1/realtime/tokens", {
          body: { identity: "alice" },
          tests: [
            statusOk(),
            `try {`,
            `  const json = pm.response.json();`,
            `  if (json?.data?.token) pm.collectionVariables.set("realtimeToken", json.data.token);`,
            `} catch (e) {}`,
          ].join("\n"),
        }),
        {
          name: "WebSocket — Channel Protocol (docs)",
          request: {
            method: "GET",
            header: [],
            url: url("{{realtimeUrl}}/ws"),
            description: [
              "Not an HTTP request — open a WebSocket to `ws://localhost:4004/ws`.",
              "",
              "Typical client flow:",
              "1. Connect with `?token={{realtimeToken}}` (or send auth message after connect).",
              "2. Subscribe to a channel, publish events, track presence.",
              "3. For CRDT docs, connect to `ws://localhost:4004/yjs/<documentId>`.",
              "",
              "Use Postman’s WebSocket request type, `wscat`, or a browser client.",
            ].join("\n"),
          },
          response: [],
        },
      ],
    ),

    folder(
      "07 WebRTC API",
      "Rooms, join, TURN credentials, signaling notes.\nBase: `{{webrtcUrl}}/api/v1/webrtc`\nSignaling WS: `ws://localhost:4005/ws`",
      [
        req("Create Room", "POST", "{{webrtcUrl}}/api/v1/webrtc/rooms", {
          body: {},
          tests: [
            statusOk(),
            `try {`,
            `  const json = pm.response.json();`,
            `  if (json?.data?.roomId) pm.collectionVariables.set("webrtcRoomId", json.data.roomId);`,
            `  if (json?.data?.token) pm.collectionVariables.set("webrtcToken", json.data.token);`,
            `} catch (e) {}`,
          ].join("\n"),
        }),
        req("Join Room", "POST", "{{webrtcUrl}}/api/v1/webrtc/rooms/{{webrtcRoomId}}/join", {
          body: {
            name: "peer-a",
            token: "{{webrtcToken}}",
            capabilities: { audio: true, video: true, screen: true, data: true },
          },
          tests: [
            statusOk(),
            `try {`,
            `  const json = pm.response.json();`,
            `  if (json?.data?.peerId) pm.collectionVariables.set("webrtcPeerId", json.data.peerId);`,
            `} catch (e) {}`,
          ].join("\n"),
        }),
        req("Get Room", "GET", "{{webrtcUrl}}/api/v1/webrtc/rooms/{{webrtcRoomId}}", {
          noJsonHeader: true,
          tests: statusOk(),
        }),
        req("TURN Credentials", "POST", "{{webrtcUrl}}/api/v1/webrtc/turn-credentials", {
          body: {},
          description: "Requires TURN_URL + TURN_SECRET env vars; otherwise returns 503.",
          tests: [
            `pm.test("responds", function () {`,
            `  pm.expect(pm.response.code).to.be.oneOf([200, 503]);`,
            `});`,
          ].join("\n"),
        }),
        {
          name: "WebSocket — Signaling (docs)",
          request: {
            method: "GET",
            header: [],
            url: url("{{webrtcUrl}}/ws"),
            description: [
              "Not an HTTP request — open a WebSocket to `ws://localhost:4005/ws`.",
              "",
              "After joining a room via HTTP, exchange offer/answer/ICE through the signaling socket.",
              "Also supports screen-share and datachannel-related control messages.",
              "",
              "Use Postman’s WebSocket request type or a browser WebRTC client.",
            ].join("\n"),
          },
          response: [],
        },
      ],
    ),

    folder(
      "08 Function API",
      "Trusted JS functions — create, invoke, webhook.\nBase: `{{functionUrl}}/api/v1/functions`",
      [
        req("Create Function", "POST", "{{functionUrl}}/api/v1/functions", {
          body: {
            name: "hello",
            description: "Echo input.message",
            runtime: "trusted-js",
            timeoutMs: 5000,
            triggers: ["http", "webhook", "manual"],
            secrets: [],
            code: "return { ok: true, message: (input && input.message) || 'hello' };",
          },
          tests: [
            saveId("functionId"),
            `try {`,
            `  const json = pm.response.json();`,
            `  if (json?.data?.name) pm.collectionVariables.set("functionName", json.data.name);`,
            `} catch (e) {}`,
          ].join("\n"),
        }),
        req("List Functions", "GET", "{{functionUrl}}/api/v1/functions", {
          noJsonHeader: true,
          tests: statusOk(),
        }),
        req("Get Function", "GET", "{{functionUrl}}/api/v1/functions/{{functionId}}", {
          noJsonHeader: true,
          tests: statusOk(),
        }),
        req("Invoke Function", "POST", "{{functionUrl}}/api/v1/functions/{{functionId}}/invoke", {
          body: { input: { message: "from postman" } },
          tests: statusOk(),
        }),
        req("Webhook Trigger", "POST", "{{functionUrl}}/api/v1/functions/{{functionName}}/webhook", {
          body: { event: "order.created", payload: { id: "ord_1" } },
          tests: statusOk(),
        }),
      ],
    ),

    folder(
      "09 Suggested Happy-Path Order",
      "Run these in sequence for an end-to-end smoke through the main APIs.",
      [
        {
          name: "README — Suggested order",
          request: {
            method: "GET",
            header: [],
            url: url("{{controlPlaneUrl}}/health"),
            description: [
              "Suggested run order:",
              "1. 00 Health & Ready (all services)",
              "2. Control Plane: Create App → Environment → Secret → Data Source → Resource → Field → API Key",
              "3. PostgreSQL: Create Data Source → resources → CRUD",
              "4. MongoDB: Create Data Source → resource → CRUD",
              "5. GraphQL: Create Schema → Execute query",
              "6. File: upload-url → complete → download-url",
              "7. Realtime: create token (then WS manually)",
              "8. WebRTC: create room → join",
              "9. Function: create → invoke → webhook",
            ].join("\n"),
          },
          response: [],
        },
      ],
    ),
  ],
};

// Add pgSourceId / pgClientId vars used by scripts
collection.variable.push(
  { key: "pgSourceId", value: "" },
  { key: "pgClientId", value: "" },
);

const environment = {
  id: uid(),
  name: "Rudra Local",
  values: [
    { key: "controlPlaneUrl", value: "http://localhost:4000", type: "default", enabled: true },
    { key: "postgresUrl", value: "http://localhost:4001", type: "default", enabled: true },
    { key: "mongodbUrl", value: "http://localhost:4002", type: "default", enabled: true },
    { key: "graphqlUrl", value: "http://localhost:4003", type: "default", enabled: true },
    { key: "realtimeUrl", value: "http://localhost:4004", type: "default", enabled: true },
    { key: "webrtcUrl", value: "http://localhost:4005", type: "default", enabled: true },
    { key: "fileUrl", value: "http://localhost:4006", type: "default", enabled: true },
    { key: "functionUrl", value: "http://localhost:4007", type: "default", enabled: true },
    {
      key: "postgresConnectionString",
      value: "postgres://rudra:rudra@localhost:5432/rudra",
      type: "secret",
      enabled: true,
    },
    {
      key: "mongodbConnectionString",
      value: "mongodb://localhost:27017/rudra",
      type: "secret",
      enabled: true,
    },
  ],
  _postman_variable_scope: "environment",
};

writeFileSync(
  join(outDir, "Rudra-Backend.postman_collection.json"),
  JSON.stringify(collection, null, 2) + "\n",
);
writeFileSync(
  join(outDir, "Rudra-Local.postman_environment.json"),
  JSON.stringify(environment, null, 2) + "\n",
);

const countReqs = (items) =>
  items.reduce((n, item) => {
    if (item.item) return n + countReqs(item.item);
    return n + 1;
  }, 0);

console.log(`Wrote collection with ${countReqs(collection.item)} requests to postman/`);
