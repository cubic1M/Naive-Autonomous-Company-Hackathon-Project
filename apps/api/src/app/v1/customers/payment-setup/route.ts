// POST /v1/customers/payment-setup (Authorization: Bearer opk_…) → { url, next_step }: a one-time Stripe link where the
// customer's owner saves a card (Cameron's createPaymentSetupLink). The public MCP tool setup_payment returns the same.
import { authCustomer } from "@/lib/auth";
import { apiBaseUrl } from "@/lib/env";
import { setupPayment } from "@/tools/edwin";
import { createPaymentSetupLink } from "@/tools/registry";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const customer = await authCustomer(req);
  if (!customer)
    return Response.json({ error: "unauthorized: send Authorization: Bearer <your Operis key>", guide: `${apiBaseUrl()}/llms.txt` }, { status: 401 });
  try {
    return Response.json(await setupPayment(customer.id, createPaymentSetupLink));
  } catch (e) {
    console.error(`[payment-setup] customer ${customer.id}: setup link failed`, e);
    return Response.json({ error: "could not create the card setup link; try again in a minute" }, { status: 502 });
  }
}
