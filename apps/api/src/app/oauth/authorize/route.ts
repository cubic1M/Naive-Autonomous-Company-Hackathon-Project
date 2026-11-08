// GET: validates the request, then sends the human to the consent page on our website (/connect),
// which signs them up or takes their existing key and calls POST /oauth/approve.
import { sql } from "@/lib/db";
import { connectPageUrl } from "@/lib/oauth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const clientId = q.get("client_id") ?? "", redirectUri = q.get("redirect_uri") ?? "";
  const [c] = await sql`select redirect_uris from oauth_clients where client_id = ${clientId}`;
  if (!c) return new Response("Unknown client_id. The app must register first.", { status: 400 });
  if (!(c.redirect_uris as string[]).includes(redirectUri)) return new Response("redirect_uri doesn't match the registered one.", { status: 400 });
  const back = (err: string) => {
    const u = new URL(redirectUri); u.searchParams.set("error", err); if (q.get("state")) u.searchParams.set("state", q.get("state")!);
    return Response.redirect(u.toString(), 302);
  };
  if (q.get("response_type") !== "code") return back("unsupported_response_type");
  if (!q.get("code_challenge") || (q.get("code_challenge_method") ?? "S256") !== "S256") return back("invalid_request");
  const page = new URL(connectPageUrl());
  for (const k of ["client_id", "redirect_uri", "code_challenge", "state", "scope", "resource"]) if (q.get(k)) page.searchParams.set(k, q.get(k)!);
  return Response.redirect(page.toString(), 302);
}
