import type { NextConfig } from "next";

// The API sends no CORS headers, so the browser calls /api/* on our own origin and Next proxies it.
const API_URL = (process.env.API_URL ?? "http://localhost:3001").replace(/\/$/, "");

const config: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_URL}/:path*` },
      // Public API paths stay reachable on the web domain, so https://operis.live/mcp works whichever
      // project serves the apex: agents' MCP, the agent guide, self-serve keys, worker/vendor endpoints.
      { source: "/mcp", destination: `${API_URL}/mcp` },
      { source: "/mcp/:path*", destination: `${API_URL}/mcp/:path*` },
      { source: "/llms.txt", destination: `${API_URL}/llms.txt` },
      { source: "/SKILL.md", destination: `${API_URL}/SKILL.md` },
      { source: "/skill.md", destination: `${API_URL}/SKILL.md` },
      { source: "/v1/:path*", destination: `${API_URL}/v1/:path*` },
      { source: "/webhooks/:path*", destination: `${API_URL}/webhooks/:path*` },
      // MCP OAuth: discovery + endpoints live on the API; the consent page (/connect) is ours
      // exact paths first: the :path* rules would add a trailing slash and loop on the API's redirect
      { source: "/.well-known/oauth-protected-resource", destination: `${API_URL}/.well-known/oauth-protected-resource` },
      { source: "/.well-known/oauth-protected-resource/:path+", destination: `${API_URL}/.well-known/oauth-protected-resource/:path+` },
      { source: "/.well-known/oauth-authorization-server", destination: `${API_URL}/.well-known/oauth-authorization-server` },
      { source: "/.well-known/oauth-authorization-server/:path+", destination: `${API_URL}/.well-known/oauth-authorization-server/:path+` },
      { source: "/.well-known/openid-configuration", destination: `${API_URL}/.well-known/openid-configuration` },
      { source: "/oauth/:path*", destination: `${API_URL}/oauth/:path*` },
    ];
  },
  async headers() {
    // Job links carry the worker's token in the path: never leak it via Referer, never cache it.
    return [
      {
        source: "/j/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};
export default config;
