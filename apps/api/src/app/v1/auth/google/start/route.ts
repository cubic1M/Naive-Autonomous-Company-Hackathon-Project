// GET /v1/auth/google/start?next=/jobs[&flow=admin]: send the browser to Google's account picker.
import { STATE_COOKIE, cookie, googleConfigured, redirect, safeNext, startUrl } from "@/lib/googleAuth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const flow = u.searchParams.get("flow") === "admin" ? "admin" : "worker";
  const next = safeNext(u.searchParams.get("next"), flow === "admin" ? "/backoffice" : "/jobs");
  if (!googleConfigured()) {
    return redirect(flow === "admin" ? "/backoffice#admin_error=google_unavailable" : `/login?error=google_unavailable&next=${encodeURIComponent(next)}`);
  }
  const { url, nonce } = startUrl(flow, next);
  return redirect(url, [cookie(STATE_COOKIE, nonce, 600)]);
}
