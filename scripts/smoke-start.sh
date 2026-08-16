#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pnpm -r --filter '@rudra/*-api' --parallel start &
PID=$!

cleanup() {
  kill "$PID" 2>/dev/null || true
}
trap cleanup EXIT

sleep 3
node scripts/health-check.mjs
