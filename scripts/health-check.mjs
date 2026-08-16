#!/usr/bin/env node
const services = [
  ["control-plane-api", 4000],
  ["postgres-api", 4001],
  ["mongodb-api", 4002],
  ["graphql-api", 4003],
  ["realtime-api", 4004],
  ["webrtc-api", 4005],
  ["file-api", 4006],
  ["function-api", 4007],
];

const host = process.env.HEALTH_HOST ?? "127.0.0.1";
let failed = 0;

for (const [service, port] of services) {
  const url = `http://${host}:${port}/health`;
  try {
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok || body.status !== "ok" || body.service !== service) {
      console.error(`FAIL ${service}: unexpected payload`, body);
      failed += 1;
    } else {
      console.log(`OK   ${service} :${port}`);
    }
  } catch (error) {
    console.error(`FAIL ${service}: ${error instanceof Error ? error.message : error}`);
    failed += 1;
  }
}

process.exit(failed === 0 ? 0 : 1);
