#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pnpm build

PIDS=()
start() {
  local filter="$1"
  local port="$2"
  PORT="$port" pnpm --filter "$filter" start >/tmp/rudra-"$port".log 2>&1 &
  PIDS+=("$!")
}

start @rudra/control-plane-api 4000
start @rudra/postgres-api 4001
start @rudra/mongodb-api 4002
start @rudra/graphql-api 4003
start @rudra/realtime-api 4004
start @rudra/webrtc-api 4005
start @rudra/file-api 4006
start @rudra/function-api 4007

cleanup() {
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:4000/health >/dev/null \
    && curl -sf http://127.0.0.1:4007/health >/dev/null; then
    break
  fi
  sleep 0.3
done

node scripts/health-check.mjs
echo "SMOKE_OK"
