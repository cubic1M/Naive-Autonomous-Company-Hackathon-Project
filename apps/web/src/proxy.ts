// Tell the API which public origin the client used (e.g. https://operis.live), so MCP OAuth metadata
// (resource, issuer, endpoints) matches the URL the user pasted. The API trusts this only for known origins.
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-operis-public-origin", request.nextUrl.origin);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/mcp", "/mcp/:path*", "/.well-known/:path*", "/oauth/:path*"],
};
