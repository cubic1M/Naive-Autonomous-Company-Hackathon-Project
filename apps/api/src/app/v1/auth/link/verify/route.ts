// GET ?t= → signs in and 302s to the stored same-site path; expired/used → /login?error=link_expired.
import { startSession, useLink } from "@/lib/accounts";
import { baseUrl } from "@/lib/env";
import { sql } from "@/lib/db";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  const l = t ? await useLink(t, "login") : null;
  if (!l) return Response.redirect(`${baseUrl()}/login?error=link_expired`, 302);
  await sql`update worker_accounts set email_verified_at = coalesce(email_verified_at, now()) where id = ${l.account_id}`;
  const cookie = await startSession(l.account_id);
  return new Response(null, { status: 302, headers: { Location: `${baseUrl()}${l.next ?? "/"}`, "Set-Cookie": cookie } });
}
