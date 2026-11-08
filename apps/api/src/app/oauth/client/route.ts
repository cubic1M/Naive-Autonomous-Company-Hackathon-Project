// GET ?client_id= → the app's display name for the consent page.
import { sql } from "@/lib/db";
import { json } from "@/lib/oauth";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("client_id") ?? "";
  const [c] = await sql`select client_name, redirect_uris from oauth_clients where client_id = ${id}`;
  if (!c) return json({ error: "unknown_client" }, 404);
  const host = (() => { try { return new URL((c.redirect_uris as string[])[0]).host; } catch { return ""; } })();
  return json({ client_name: c.client_name, redirect_host: host });
}
