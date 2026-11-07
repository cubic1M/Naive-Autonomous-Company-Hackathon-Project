import path from "node:path";
import type { NextConfig } from "next";

// The API imports ../../contracts and ../../services, so the build root is the repo root.
const repoRoot = path.join(import.meta.dirname, "../..");

const config: NextConfig = {
  outputFileTracingRoot: repoRoot,
  // services/outreach uses NodeNext-style imports ("./blast.js" → blast.ts); webpack maps them.
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return cfg;
  },
};
export default config;
