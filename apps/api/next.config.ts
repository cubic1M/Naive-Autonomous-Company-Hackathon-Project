import path from "node:path";
import type { NextConfig } from "next";

// The API imports ../../contracts and ../../services, so the build root is the repo root.
const repoRoot = path.join(import.meta.dirname, "../..");

const config: NextConfig = {
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
};
export default config;
