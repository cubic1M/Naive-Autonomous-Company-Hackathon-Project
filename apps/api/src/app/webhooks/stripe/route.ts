// Stripe webhooks. Edwin owns the route; Cameron owns the payment logic.
// checkout.session.completed with a manual-capture PaymentIntent = hold placed → job `held` → CEO wakes.
import Stripe from "stripe";
import { sql } from "@/lib/db";
import { transition } from "@/lib/jobs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const key = process.env.STRIPE_SECRET_KEY, secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !secret) return new Response("stripe not configured", { status: 501 });
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = new Stripe(key).webhooks.constructEvent(raw, req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return new Response("bad signature", { status: 400 });
  }
  const fresh = await sql`insert into webhook_events (provider, event_id, type) values ('stripe', ${event.id}, ${event.type})
                          on conflict do nothing returning event_id`;
  if (!fresh.length) return Response.json({ ok: true, duplicate: true });

  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    const jobId = s.metadata?.job_id;
    if (jobId) {
      await transition(jobId, "held", { stripe_payment_intent: typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id });
    }
  }
  return Response.json({ ok: true });
}
