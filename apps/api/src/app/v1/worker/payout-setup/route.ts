// POST { token } → a Stripe Connect onboarding link for the worker (Cameron's createPayoutLink).
import { outreachByToken } from "@/lib/worker";
import payments from "@services/payments/index";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const { token } = await req.json();
  const o = token ? await outreachByToken(token) : undefined;
  if (!o) return Response.json({ error: "not_found" }, { status: 404 });
  const createPayoutLink = (payments as any).createPayoutLink as undefined | ((workerId: string) => Promise<{ url: string }>);
  if (!createPayoutLink) return Response.json({ url: null, note: "payouts not wired yet (services/payments createPayoutLink)" });
  return Response.json(await createPayoutLink(o.worker_id));
}
