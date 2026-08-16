#!/usr/bin/env node
/**
 * Run a pnpm workspace script against only packages or only apps.
 * Avoids `!` exclusion filters, which break in Git Bash (history expansion).
 *
 * Usage:
 *   node scripts/run-scoped.mjs packages build
 *   node scripts/run-scoped.mjs apps test
 *   node scripts/run-scoped.mjs apps --parallel dev
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const scope = process.argv[2];
const args = process.argv.slice(3);

if (!scope || args.length === 0 || !["packages", "apps"].includes(scope)) {
  console.error("Usage: node scripts/run-scoped.mjs <packages|apps> [--parallel] <script>");
  process.exit(1);
}

const dirs = readdirSync(join(process.cwd(), scope), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const filters = [];
for (const name of dirs) {
  filters.push("--filter", `@rudra/${name}`);
}

const pnpmArgs = ["-r", ...filters];
if (args[0] === "--parallel") {
  pnpmArgs.push("--parallel");
  pnpmArgs.push(...args.slice(1));
} else {
  pnpmArgs.push(...args);
}

const result = spawnSync("pnpm", pnpmArgs, {
  stdio: "inherit",
  shell: true,
  env: process.env,
});

process.exit(result.status ?? 1);
