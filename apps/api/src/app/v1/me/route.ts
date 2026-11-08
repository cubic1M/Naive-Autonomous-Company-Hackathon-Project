// GET /v1/me: the signed-in worker. PATCH /v1/me: save onboarding / account fields.
import { currentAccount, publicUser, updateAccount } from "@/lib/workerAccounts";
export const dynamic = "force-dynamic";

const unauth = () => Response.json({ error: "login_required" }, { status: 401 });

export async function GET(req: Request) {
  const a = await currentAccount(req);
  return a ? Response.json({ user: publicUser(a) }, { headers: { "Cache-Control": "no-store" } }) : unauth();
}

export async function PATCH(req: Request) {
  const a = await currentAccount(req);
  if (!a) return unauth();
  const b = await req.json().catch(() => ({}));
  return Response.json({ ok: true, user: publicUser(await updateAccount(a, b && typeof b === "object" ? b : {})) });
}
