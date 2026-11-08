// MCP authorization (OAuth 2.1 authorization code + PKCE, RFC 7591 dynamic registration, RFC 9728 resource
// metadata). The public origin is whatever host the client used (operis.live via the web rewrite, or
// api.operis.live), so metadata and redirects stay on that host.
import { createHash, randomBytes } from "node:crypto";
import { baseUrl } from "./env";

export function publicOrigin(req: Request): string {
  const fwd = req.headers.get("x-forwarded-host");
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  if (fwd) return `${proto}://${fwd.split(",")[0].trim()}`;
  return new URL(req.url).origin;
}

/** Where the human-facing consent page lives (Dora's site). */
export function connectPageUrl(): string {
  return `${baseUrl()}/connect`;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const token = (prefix = "", bytes = 32) => prefix + randomBytes(bytes).toString("base64url");

/** PKCE S256: base64url(sha256(verifier)) === challenge */
export function pkceOk(verifier: string, challenge: string): boolean {
  if (!verifier || verifier.length < 43 || verifier.length > 128) return false;
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version",
};
export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store", ...extra } });
export const preflight = () => new Response(null, { status: 204, headers: CORS });

export function resourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["operis"],
    resource_name: "Operis",
    resource_documentation: `${origin}/llms.txt`,
  };
}

export function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["operis"],
    service_documentation: `${origin}/llms.txt`,
  };
}
