// Load apps/api/.env.local (or .env) into process.env for scripts.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
const root = path.join(import.meta.dirname, "..");
for (const f of ["apps/api/.env.local", "apps/api/.env"]) {
  const p = path.join(root, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
export const ROOT = root;
export const API = (process.env.API ?? process.env.PUBLIC_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
