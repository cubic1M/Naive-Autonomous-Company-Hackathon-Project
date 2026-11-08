// Stripe webhooks: Cameron's handler (services/payments → money-verification) verifies the signature,
// dedupes, and moves the job via our transition() (checkout completed → held → CEO wakes, refunds, disputes...).
import { stripeWebhook } from "@services/payments/index";
import { sql } from "@/lib/db";
import { transition } from "@/lib/jobs";
import { baseUrl } from "@/lib/env";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) return new Response("stripe not configured", { status: 501 });
  return stripeWebhook(req, { sql, transition, baseUrl: baseUrl(), log: (...a: unknown[]) => console.log("[stripe]", ...a) } as any);
}
