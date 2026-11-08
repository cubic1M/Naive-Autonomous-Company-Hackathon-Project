// Stripe webhooks: Cameron's handler (services/payments → money-verification) verifies the signature,
// dedupes, and moves the job via our transition() (checkout completed → held → CEO wakes, refunds, disputes...).
import { stripeWebhook } from "@services/payments/index";
import { sql } from "@/lib/db";
import { transition } from "@/lib/jobs";
import { baseUrl } from "@/lib/env";
import { wake } from "@/lib/naive";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) return new Response("stripe not configured", { status: 501 });
  const wakeDisputes = async (disputeId: string, jobId: string | null) => {
    if (!jobId) { console.warn(`[stripe] dispute ${disputeId} has no job id; Disputes agent not woken`); return; }
    await wake("disputes", jobId, `dispute:${disputeId}`, `Stripe chargeback ${disputeId} was opened on job ${jobId}. Call operis.get_dispute with dispute_id "${disputeId}", read the proof review, decide, draft evidence with operis.submit_dispute_evidence, and write the decision on the job's board card.`);
  };
  return stripeWebhook(req, { sql, transition, baseUrl: baseUrl(), log: (...a: unknown[]) => console.log("[stripe]", ...a), wakeDisputes } as any);
}
