// 1. admin.operis.live → the founders' backoffice at the root.
// 2. API paths: tell the API which public origin the client used (e.g. https://operis.live), so MCP OAuth
//    metadata matches the URL the user pasted. The API trusts this only for known origins.
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const path = request.nextUrl.pathname;
  if (host.startsWith("admin.") && path === "/") {
    return NextResponse.rewrite(new URL("/backoffice", request.url));
  }
  if (path === "/") return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.set("x-operis-public-origin", request.nextUrl.origin);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/", "/mcp", "/mcp/:path*", "/.well-known/:path*", "/oauth/:path*", "/SKILL.md", "/skill.md"],
};
