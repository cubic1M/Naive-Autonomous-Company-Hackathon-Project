// POST {id_type, return_url} → {ok, url}: Stripe Identity (ID + matching selfie) through Cameron's
// createIdentityLink. The webhook sets the final status; GET /v1/me reads it back.
import { currentAccount, json, loginRequired, userJson } from "@/lib/accounts";
import { sql } from "@/lib/db";
import * as verify from "@services/verify/index";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const a = await currentAccount(req);
  if (!a) return loginRequired();
  const b = await req.json().catch(() => ({}));
  const createIdentityLink = (verify as any).createIdentityLink as
    | undefined | ((workerId: string) => Promise<{ url: string | null; status: string }>);
  if (!createIdentityLink || !a.worker_id) return json({ ok: false, error: "identity_unavailable" }, 503);
  try {
    const r = await createIdentityLink(a.worker_id);
    const status = r.status === "verified" ? "verified" : "processing";
    const [u] = await sql`update worker_accounts set identity_status = ${status}, id_type = ${b.id_type ? String(b.id_type).slice(0, 40) : a.id_type}, updated_at = now()
                          where id = ${a.id} returning *`;
    return json({ ok: true, url: r.url, user: userJson(u) });
  } catch (e: any) {
    console.error("[me/identity]", e);
    return json({ ok: false, error: "identity_unavailable" }, 502);
  }
}
