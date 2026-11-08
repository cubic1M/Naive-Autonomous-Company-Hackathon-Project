"use client";

// Port of the design's "Log in from a recommended job" artboard (LoginFromJob.dc.html).
import Link from "next/link";
import { useEffect, useState } from "react";

import { getJob, type WorkerJob } from "@/lib/api";
import { deadlineText, usd } from "@/lib/format";
import { useSession } from "@/lib/session";
import LoginMethods, { introFor, type Mode } from "./LoginMethods";
import { AuthFooter, SimpleHeader, headerLink } from "./AuthPage";
import { primary } from "./ui";

const ic = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "#46664F", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, style: { flex: "none" } };

export default function LoginFromJob({ token, next }: { token: string; next: string }) {
  const { user } = useSession();
  const [data, setData] = useState<WorkerJob | null>(null);
  const [mode, setMode] = useState<Mode>("start");
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    getJob(token).then((r) => {
      if (r.ok) {
        setData(r.data);
        setHint(r.data.viewer && !r.data.viewer.logged_in ? r.data.viewer.phone_hint ?? null : null);
      }
    });
  }, [token]);

  const job = data?.job;
  const deadline = job ? deadlineText(job.deadline) : null;

  return (
    <div style={{ overflow: "hidden", background: "#ECE8DF" }}>
      <div style={{ color: "#232824", background: "#ECE8DF", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <SimpleHeader action={<Link href={next} style={headerLink}>Back to job</Link>} />

        <div style={{ background: "#E9EFE4", borderBottom: "1px solid #DCE6D8" }}>
          <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "12px 24px", display: "flex", alignItems: "center", gap: "10px", fontSize: "14px", color: "#2F4A37" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}><path d="M4 5h16v11H8l-4 4z" /></svg>
            <span>You opened a job we texted you. Log in to see if you&apos;re cleared for it, then accept or pass.</span>
          </div>
        </div>

        <main style={{ flex: "1", width: "100%", maxWidth: "1180px", margin: "0 auto", boxSizing: "border-box", padding: "36px 24px 56px", display: "flex", flexWrap: "wrap", gap: "28px", alignItems: "flex-start" }}>
          <section aria-label="The job you opened" style={{ flex: "1 1 380px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ background: "#FBF9F5", border: "1px solid #DCD6CA", borderRadius: "14px", overflow: "hidden" }}>
              <div style={{ padding: "22px 24px", background: "radial-gradient(120% 110% at 88% 0%, #43594A 0%, #26342B 42%, #151D17 100%)", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", borderRadius: "999px", background: "#FBF9F5", color: "#2F4A37", fontSize: "13px", fontWeight: 600 }}>{job?.category ?? "Job"}</span>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#C3CBC2" }}>Matched for you</span>
                </div>
                <h1 style={{ margin: "0", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "24px", lineHeight: 1.2, letterSpacing: "-0.035em", color: "#F3EEE4" }}>{job?.title ?? "Loading…"}</h1>
                {job && (
                  <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "34px", letterSpacing: "-0.035em", color: "#F3EEE4" }}>{usd(job.pay_usd)}</span>
                    <span style={{ fontSize: "14px", color: "#C3CBC2" }}>paid when your proof is approved</span>
                  </div>
                )}
              </div>
              {job && (
                <ul style={{ listStyle: "none", margin: "0", padding: "18px 24px 22px", display: "flex", flexDirection: "column", gap: "12px", fontSize: "14px", color: "#3C443E" }}>
                  {job.company && <li style={{ display: "flex", gap: "10px", alignItems: "center" }}><svg {...ic}><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /></svg><span><strong>{job.company}</strong> · agent company, business verified</span></li>}
                  <li style={{ display: "flex", gap: "10px", alignItems: "center" }}><svg {...ic}><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>{job.location.address}</li>
                  {job.certification_required && <li style={{ display: "flex", gap: "10px", alignItems: "center" }}><svg {...ic}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>Needs {job.certification_required}</li>}
                  <li style={{ display: "flex", gap: "10px", alignItems: "center" }}><svg {...ic}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg><span><strong>{deadline!.text}</strong> · {deadline!.left}</span></li>
                </ul>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "18px 20px", borderRadius: "14px", background: "#E5E1D7" }}>
              <span style={{ fontSize: "14px", fontWeight: 700, color: "#1F2A22" }}>After you log in</span>
              <ol style={{ margin: "0", paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px", lineHeight: 1.5, color: "#3C443E" }}>
                <li>We check your ID{job?.certification_required ? " and license" : ""} are verified</li>
                <li>You go straight back to this job</li>
                <li>Accept it, or pass and tell us why</li>
              </ol>
            </div>
          </section>

          <section aria-label="Log in" style={{ flex: "1 1 400px", background: "#FBF9F5", border: "1px solid #DCD6CA", borderRadius: "14px", padding: "32px", display: "flex", flexDirection: "column", gap: "18px" }}>
            {user ? (
              <>
                <h2 style={{ margin: "0", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "26px", letterSpacing: "-0.035em", color: "#1F2A22" }}>You&apos;re logged in</h2>
                <Link href={next} style={primary}>Back to the job</Link>
              </>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <h2 style={{ margin: "0", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "26px", letterSpacing: "-0.035em", color: "#1F2A22" }}>Welcome back</h2>
                  <p style={{ margin: "0", fontSize: "15px", lineHeight: 1.55, color: "#4F5751" }}>{introFor(mode, hint, true)}</p>
                </div>
                <LoginMethods next={next} jobToken={token} phoneHint={hint} onModeChange={(m, h) => { setMode(m); setHint(h); }} />
                <p style={{ margin: "0", paddingTop: "14px", borderTop: "1px solid #E3DED3", fontSize: "14px", lineHeight: 1.5, color: "#4F5751" }}>
                  Not you, or no account yet? <Link href={`/signup?next=${encodeURIComponent(next)}`} style={{ fontWeight: 600, color: "#3B5A44" }}>Create an account</Link> to apply. This job stays saved for you.
                </p>
              </>
            )}
          </section>
        </main>
        <AuthFooter />
      </div>
    </div>
  );
}
