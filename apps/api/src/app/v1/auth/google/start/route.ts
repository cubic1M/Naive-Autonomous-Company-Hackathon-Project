// Google sign-in isn't set up yet: send people to the email/password login with a clear message.
import { baseUrl } from "@/lib/env";
import { safeNext } from "@/lib/accounts";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  return Response.redirect(`${baseUrl()}/login?error=google_unavailable&next=${encodeURIComponent(next)}`, 302);
}
