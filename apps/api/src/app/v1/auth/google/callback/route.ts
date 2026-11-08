// GET /v1/auth/google/callback?code&state: Google sends the browser back here.
// Workers: sign in to the account with this Google id or (Google-verified) email, or create one; then onboarding
// the first time, else straight back to `next`. Founders (flow=admin): the email must be on ADMIN_EMAILS; the
// backoffice gets its token in the URL fragment (never sent to a server).
import { allowedAdminEmails, issueSession } from "@/lib/adminSession";
import { startSession, workerFor } from "@/lib/accounts";
import { sql } from "@/lib/db";
import { STATE_COOKIE, cookie, cookieValue, exchangeCode, readState, redirect } from "@/lib/googleAuth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const clear = cookie(STATE_COOKIE, "", 0);
  const st = readState(u.searchParams.get("state"), cookieValue(req, STATE_COOKIE));
  if (!st) return redirect("/login?error=google_failed", [clear]);
  const fail = (e: string) =>
    st.flow === "admin" ? redirect(`/backoffice#admin_error=${e}`, [clear]) : redirect(`/login?error=${e}&next=${encodeURIComponent(st.next)}`, [clear]);
  const code = u.searchParams.get("code");
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

  // Google verified this email, so an existing account with it is theirs (and its email is now verified).
  let [a] = await sql`select * from worker_accounts where google_sub = ${g.sub} or lower(email) = ${g.email}
                      order by (google_sub = ${g.sub}) desc nulls last limit 1`;
  if (a) {
    [a] = await sql`update worker_accounts set google_sub = ${g.sub}, email_verified_at = coalesce(email_verified_at, now()), updated_at = now()
                    where id = ${a.id} returning *`;
  } else {
    const name = g.name || g.email.split("@")[0]!;
    const workerId = await workerFor(name, g.email, null);
    [a] = await sql`insert into worker_accounts (worker_id, name, email, google_sub, email_verified_at)
                    values (${workerId}, ${name}, ${g.email}, ${g.sub}, now()) returning *`;
  }
  const session = await startSession(a!.id, true);
  return redirect(a!.profile?.onboarding_done ? st.next : `/onboarding?next=${encodeURIComponent(st.next)}`, [clear, session]);
}
