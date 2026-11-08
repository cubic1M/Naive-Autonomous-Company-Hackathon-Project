// GET ?t= → signs in and 302s to the stored same-site path; expired/used → /login?error=link_expired.
import { noteLogin, startSession, useLink } from "@/lib/accounts";
import { baseUrl } from "@/lib/env";
import { sql } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  const l = t ? await useLink(t, "login") : null;
  if (!l) return Response.redirect(`${baseUrl()}/login?error=link_expired`, 302);
  await sql`update worker_accounts set email_verified_at = coalesce(email_verified_at, now()) where id = ${l.account_id}`;
  await noteLogin(l.account_id, "email_link").catch(() => null);
  const cookie = await startSession(l.account_id);
  const next = l.next ?? "/";
  const to = `${next}${next.includes("?") ? "&" : "?"}signed_in=email_link`;
  return new Response(null, { status: 302, headers: { Location: `${baseUrl()}${to}`, "Set-Cookie": cookie } });
}
