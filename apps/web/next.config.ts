import type { NextConfig } from "next";

// The API sends no CORS headers, so the browser calls /api/* on our own origin and Next proxies it.
const API_URL = (process.env.API_URL ?? "http://localhost:3001").replace(/\/$/, "");

const config: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
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
