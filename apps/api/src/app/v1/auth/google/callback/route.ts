// GET /v1/auth/google/callback?code&state: Google sends the browser back here.
// Worker flow: find or create the account, start a session cookie, go to onboarding (first time) or `next`.
// Admin flow: the Google email must be on ADMIN_EMAILS; hand the backoffice a founder token in the URL fragment.
import { allowedAdminEmails, issueSession } from "@/lib/adminSession";
import { STATE_COOKIE, cookie, cookieValue, exchangeCode, readState, redirect } from "@/lib/googleAuth";
import { startSession, upsertGoogleAccount } from "@/lib/accounts";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const clear = cookie(STATE_COOKIE, "", 0);
  const st = readState(u.searchParams.get("state"), cookieValue(req, STATE_COOKIE));
  const code = u.searchParams.get("code");
  if (!st) return redirect("/login?error=google_failed", [clear]);
  const fail = (e: string) =>
    st.flow === "admin" ? redirect(`/backoffice#admin_error=${e}`, [clear]) : redirect(`/login?error=${e}&next=${encodeURIComponent(st.next)}`, [clear]);
  if (!code) return fail(u.searchParams.get("error") === "access_denied" ? "google_cancelled" : "google_failed");

  let g;
  try {
    g = await exchangeCode(code);
  } catch (e) {
    console.error(e);
    return fail("google_failed");
  }

  if (st.flow === "admin") {
    if (!allowedAdminEmails().includes(g.email)) return fail("not_a_founder");
    const s = issueSession(g.email);
    return redirect(`/backoffice#admin_token=${encodeURIComponent(s.token)}&email=${encodeURIComponent(g.email)}`, [clear]);
  }

  const a = await upsertGoogleAccount(g);
  const session = await startSession(a.id);
  const done = (a.profile as { onboarding_done?: boolean })?.onboarding_done;
  return redirect(done ? st.next : `/onboarding?next=${encodeURIComponent(st.next)}`, [clear, session]);
}
