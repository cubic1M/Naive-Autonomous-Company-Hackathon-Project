// Text-message codes need an SMS provider; Operis uses email for now (email link or password).
import { json } from "@/lib/accounts";
export const dynamic = "force-dynamic";

export async function POST() {
  return json({ ok: false, error: "sms_unavailable", message: "Text codes aren't available yet. Log in with your email instead." }, 501);
}
