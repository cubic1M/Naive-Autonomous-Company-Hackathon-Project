// POST { token } → a Stripe Identity link for the worker (Cameron's createIdentityLink), or { url: null, status: "verified" }.
// Return page: <PUBLIC_BASE_URL>/join/<workerId>/identity/done (Dora's site).
import { outreachByToken } from "@/lib/worker";
import * as verify from "@services/verify/index";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { token } = await req.json().catch(() => ({}));
  const o = token ? await outreachByToken(token) : undefined;
  if (!o) return Response.json({ error: "not_found" }, { status: 404 });
  const createIdentityLink = (verify as any).createIdentityLink as
    | undefined
    | ((workerId: string) => Promise<{ url: string | null; status: "pending" | "verified" | "failed" | "needs_review" }>);
  if (!createIdentityLink) return Response.json({ url: null, note: "identity not wired yet (services/verify createIdentityLink)" });
  try {
    return Response.json(await createIdentityLink(o.worker_id));
  } catch (e: any) {
    console.error("[identity]", e);
    return Response.json({ error: "identity_unavailable", message: String(e?.message ?? e).slice(0, 200) }, { status: 502 });
  }
}
