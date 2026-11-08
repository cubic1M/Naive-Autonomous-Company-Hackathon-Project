"use client";

// Port of the design's "Job details · accept, decline, feedback" artboard (Job.dc.html), on real
// job data. Anyone with the link can read the job; accepting or declining needs a logged-in worker.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { acceptJob, declineJob, getJob, postJson, type WorkerJob } from "@/lib/api";
import { deadlineText, mapsUrl, usd } from "@/lib/format";
import { useSession } from "@/lib/session";
import SiteHeader from "@/components/SiteHeader";
import { AuthFooter } from "@/components/auth/AuthPage";
import { Spinner } from "@/components/auth/ui";
import { Expired, Offline } from "@/components/ui";

const ACCENT = "#46664F";
const JOB_REASONS = ["Pay is too low", "Too far away", "Timing does not work", "Not my kind of work", "Unsure about the requester", "Other"];

type Load = { kind: "loading" } | { kind: "expired" } | { kind: "offline" } | { kind: "ready"; data: WorkerJob };
type Decision = null | "declining" | "declined" | "taken";

const card = { background: "#FBF9F5", border: "1px solid #DCD6CA", borderRadius: "14px", padding: "22px", display: "flex", flexDirection: "column", gap: "14px" } as const;
const h2 = { margin: "0", fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 500, color: "#1F2A22", letterSpacing: "-0.02em" } as const;
const sectionH = { margin: "0", fontSize: "16px", fontWeight: 700, color: "#1F2A22", fontFamily: "var(--font)", letterSpacing: "normal" } as const;
const listStyle = { margin: "0", paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "8px", fontSize: "15px", lineHeight: 1.55, color: "#3C443E" } as const;
const primaryBtn = { minHeight: "48px", border: "0", borderRadius: "8px", font: "inherit", fontSize: "15px", fontWeight: 600, color: "#FFFFFF", background: ACCENT, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", textDecoration: "none" } as const;
const outlineBtn = { minHeight: "48px", border: "1px solid #C5BEB0", borderRadius: "8px", background: "#FBF9F5", color: "#232824", font: "inherit", fontSize: "15px", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" } as const;
const TONES = { good: { background: "#E9EFE4", color: "#2F4A37" }, info: { background: "#E2EBE8", color: "#2F4A4A" }, warn: { background: "#F6EAD3", color: "#8A5300" }, bad: { background: "#F6E1DE", color: "#A12A22" } } as const;
const notice = (tone: keyof typeof TONES) => ({ display: "flex", gap: "10px", alignItems: "flex-start", padding: "14px", borderRadius: "12px", fontSize: "14px", lineHeight: 1.5, ...TONES[tone] }) as const;

const Check = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", marginTop: "1px" }}><path d="M5 12l5 5 9-10" /></svg>
);
const Tick = ({ ok }: { ok: boolean }) => (
  <span aria-hidden="true" style={{ flex: "none", width: "22px", height: "22px", borderRadius: "999px", background: ok ? "#E2EADE" : "#F6E1DE", color: ok ? "#2F4A37" : "#A12A22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700 }}>{ok ? "✓" : "!"}</span>
);
function Fact({ icon, k, v, sub }: { icon: React.ReactNode; k: string; v: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "10px" }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#46664F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", marginTop: "2px" }}>{icon}</svg>
      <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <span style={{ fontSize: "13px", color: "#5B635C" }}>{k}</span>
        <strong style={{ fontSize: "15px" }}>{v}</strong>
        {sub && <span style={{ fontSize: "13px", color: "#5B635C" }}>{sub}</span>}
      </span>
    </div>
  );
}

export default function JobPage({ token }: { token: string }) {
  const { user } = useSession();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [decision, setDecision] = useState<Decision>(null);
  const [reasons, setReasons] = useState<Record<string, boolean>>({});
  const [similar, setSimilar] = useState<boolean | null>(null);
  const [more, setMore] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const jobPath = `/j/${encodeURIComponent(token)}`;
  const loginHref = `/login?next=${encodeURIComponent(jobPath)}`;
  const signupHref = `/signup?next=${encodeURIComponent(jobPath)}`;

  const refresh = useCallback(async () => {
    const r = await getJob(token);
    if (r.ok) setLoad({ kind: "ready", data: r.data });
    else if (r.status === 404) setLoad({ kind: "expired" });
    else setLoad((prev) => (prev.kind === "ready" ? prev : { kind: "offline" }));
    return r;
  }, [token]);

  // Re-read when the session changes, so "cleared for this job" reflects who's logged in.
  useEffect(() => {
    refresh();
  }, [refresh, user?.id]);

  const state = load.kind === "ready" ? load.data.state : null;
  useEffect(() => {
    if (state !== "proof_submitted" && state !== "escalated" && state !== "approved") return;
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [state, refresh]);

  async function onAccept() {
    setBusy("accept");
    setError(null);
    const r = await acceptJob(token);
    if (r.ok) await refresh();
    else if (r.status === 401) window.location.assign(loginHref);
    else if (r.status === 403) setError("Verify your identity before accepting jobs. It takes a few minutes with Stripe.");
    else if (r.status === 409) {
      // A retried request may already have succeeded: check whether the job is now ours.
      const again = await refresh();
      if (!(again.ok && again.data.state === "accepted")) setDecision("taken");
    } else if (r.status === 404) setLoad({ kind: "expired" });
    else setError("We couldn't reach Operis. Check your signal and try again.");
    setBusy(null);
  }

  async function sendDecline() {
    setBusy("decline");
    setError(null);
    const r = await declineJob(token, { reasons: JOB_REASONS.filter((x) => reasons[x]), more_like_this: similar });
    setBusy(null);
    if (r.ok) setDecision("declined");
    else if (r.status === 401) window.location.assign(loginHref);
    else if (r.status === 404) setLoad({ kind: "expired" });
    else setError("We couldn't reach Operis. Check your signal and try again.");
  }

  async function sendMore(v: boolean) {
    setMore(v);
    await postJson(`/v1/worker/jobs/${encodeURIComponent(token)}/feedback`, { more_like_this: v });
  }

  if (load.kind === "loading") return <div style={{ minHeight: "100vh", background: "#ECE8DF" }} aria-busy="true" />;
  if (load.kind === "expired") return <Expired />;
  if (load.kind === "offline") return <Offline retry={() => { setLoad({ kind: "loading" }); refresh(); }} />;

  const { job, can_accept, reply_code, viewer } = load.data;
  const s = load.data.state;
  // Accepting or declining needs a worker account (docs/ACCOUNTS_API.md; the API answers 401 login_required).
  // NEXT_PUBLIC_WORKER_LOGIN=optional turns the gate off again (the job link alone is the credential).
  const loginRequired = process.env.NEXT_PUBLIC_WORKER_LOGIN !== "optional";
  const loggedIn = !!user || !loginRequired;
  const deadline = deadlineText(job.deadline);
  const proofPath = `${jobPath}/proof`;
  const payoutPath = `${jobPath}/payout`;
  const req = job.proof_requirement;
  const cleared = viewer?.logged_in ? viewer.cleared : false;
  const idStatus = viewer?.logged_in ? viewer.identity_status : user?.identity.status ?? null;
  const hasLicense = !!user?.licenses.some((l) => l.status === "active");
  const chip = (on: boolean) => ({ minHeight: "40px", padding: "0 12px", borderRadius: "999px", font: "inherit", fontSize: "13px", fontWeight: 600, cursor: "pointer", ...(on ? { border: `1px solid ${ACCENT}`, background: ACCENT, color: "#FFFFFF" } : { border: "1px solid #D2CCBF", background: "#FBF9F5", color: "#2B302C" }) });
  const seg = (on: boolean) => ({ minHeight: "44px", borderRadius: "8px", font: "inherit", fontSize: "14px", fontWeight: 600, cursor: "pointer", ...(on ? { border: `1px solid ${ACCENT}`, background: "#E2EADE", color: "#1F2A22" } : { border: "1px solid #D2CCBF", background: "#FBF9F5", color: "#2B302C" }) });

  // ---------- the decision panel, by job state ----------
  let decisionPanel: React.ReactNode;
  if (decision === "taken") {
    decisionPanel = (
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <h2 style={h2}>Someone else got this one</h2>
        <p style={{ margin: "0", fontSize: "14px", lineHeight: 1.5, color: "#4F5751" }}>The first person to say yes gets the job. We&apos;ll send you the next one nearby.</p>
        <Link href="/jobs" style={outlineBtn}>Browse other requests</Link>
      </div>
    );
  } else if (decision === "declined") {
    decisionPanel = (
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "15px", fontWeight: 600, color: "#2F4A37" }}><Check />Thanks, your preferences are updated</span>
        <span style={{ fontSize: "14px", lineHeight: 1.5, color: "#4F5751" }}>{similar === false ? "We will send fewer jobs like this and use your reasons to tune future matches." : "We will keep sending similar jobs and use your reasons to tune them."}</span>
        <Link href="/jobs" style={{ ...outlineBtn, minHeight: "44px", fontSize: "14px" }}>Browse other requests</Link>
      </div>
    );
  } else if (decision === "declining") {
    decisionPanel = (
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <h2 style={h2}>Decline this job?</h2>
          <span style={{ fontSize: "14px", color: "#4F5751" }}>Tell us why so we send you better matches.</span>
        </div>
        <fieldset style={{ border: "0", margin: "0", padding: "0", display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <legend style={{ padding: "0 0 8px", fontSize: "14px", fontWeight: 600 }}>Reasons (pick any)</legend>
          {JOB_REASONS.map((r) => (
            <button key={r} type="button" aria-pressed={!!reasons[r]} onClick={() => setReasons({ ...reasons, [r]: !reasons[r] })} style={chip(!!reasons[r])}>{r}</button>
          ))}
        </fieldset>
        <fieldset style={{ border: "0", margin: "0", padding: "0", display: "flex", flexDirection: "column", gap: "8px" }}>
          <legend style={{ padding: "0 0 8px", fontSize: "14px", fontWeight: 600 }}>Keep sending similar jobs?</legend>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
            <button type="button" aria-pressed={similar === true} onClick={() => setSimilar(true)} style={seg(similar === true)}>Yes</button>
            <button type="button" aria-pressed={similar === false} onClick={() => setSimilar(false)} style={seg(similar === false)}>Fewer like this</button>
          </div>
        </fieldset>
        <button type="button" onClick={sendDecline} disabled={busy !== null} style={{ ...primaryBtn, minHeight: "46px" }}>{busy === "decline" && <Spinner />}Decline and send feedback</button>
        <button type="button" onClick={() => setDecision(null)} style={{ minHeight: "40px", border: "0", background: "transparent", color: "#3B5A44", font: "inherit", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>Undo, I want this job</button>
      </div>
    );
  } else if (s === "open" && can_accept) {
    decisionPanel = (
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <h2 style={h2}>Take this job?</h2>
        {loggedIn ? (
          <button type="button" onClick={onAccept} disabled={busy !== null} style={primaryBtn}>{busy === "accept" ? <><Spinner /> Claiming the job…</> : `Accept job · ${usd(job.pay_usd)}`}</button>
        ) : (
          <Link href={loginHref} style={primaryBtn}>Log in to accept</Link>
        )}
        {loggedIn ? (
          <button type="button" onClick={() => setDecision("declining")} disabled={busy !== null} style={outlineBtn}>Decline</button>
        ) : (
          <Link href={loginHref} style={outlineBtn}>Log in to decline</Link>
        )}
        <p style={{ margin: "0", fontSize: "13px", lineHeight: 1.5, color: "#5B635C" }}>
          First person to say yes gets the job. Accepting confirms you&apos;ll do it before the deadline. The company gets your first name and verification status only.
        </p>
        {reply_code && !loggedIn && (
          <p style={{ margin: "0", fontSize: "13px", lineHeight: 1.5, color: "#5B635C" }}>Or reply <span className="mono">YES {reply_code}</span> / <span className="mono">NO {reply_code}</span> to our text.</p>
        )}
      </div>
    );
  } else if (s === "open") {
    decisionPanel = <div style={notice("info")}>You already answered this one. We&apos;ll send you the next job that fits.</div>;
  } else if (s === "unavailable") {
    decisionPanel = (
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={notice("warn")}>This job has been taken or closed. We&apos;ll send you the next one.</div>
        <Link href="/jobs" style={{ ...outlineBtn, minHeight: "44px", fontSize: "14px" }}>Browse other requests</Link>
      </div>
    );
  } else if (s === "accepted") {
    decisionPanel = (
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={notice("good")}><Check /><span><strong>Job accepted.</strong> Do the job, then upload your proof from the location before the deadline.</span></div>
        {load.data.can_upload_proof && <Link href={proofPath} style={primaryBtn}>I&apos;m there, upload proof</Link>}
        {more === null ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <span style={{ fontSize: "15px", fontWeight: 600 }}>Want more jobs like this one?</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
              <button type="button" onClick={() => sendMore(true)} style={{ minHeight: "44px", border: "0", borderRadius: "8px", background: "#E2EADE", color: "#2F4A37", font: "inherit", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>Yes, more like this</button>
              <button type="button" onClick={() => sendMore(false)} style={{ minHeight: "44px", border: "1px solid #D2CCBF", borderRadius: "8px", background: "#FBF9F5", color: "#232824", font: "inherit", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>Not really</button>
            </div>
          </div>
        ) : (
          <span style={{ fontSize: "14px", color: "#4F5751" }}>{more ? "We'll send you more jobs like this one." : "Got it. We'll show you fewer jobs like this."}</span>
        )}
      </div>
    );
  } else if (s === "proof_submitted") {
    decisionPanel = <div style={notice("info")}><span><strong>Proof received.</strong> We&apos;re checking it now; this usually takes a few minutes.</span></div>;
  } else if (s === "escalated") {
    decisionPanel = <div style={notice("info")}><span><strong>A person is reviewing your proof.</strong> We&apos;ll let you know soon.</span></div>;
  } else if (s === "approved") {
    decisionPanel = (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={notice("good")}><Check /><span><strong>Approved!</strong> Your {usd(job.pay_usd)} is on the way. Connect a bank account to receive it.</span></div>
        <Link href={payoutPath} style={primaryBtn}>Set up payout</Link>
      </div>
    );
  } else if (s === "paid") {
    decisionPanel = (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={notice("good")}><Check /><span><strong>Paid: {usd(job.pay_usd)}.</strong> Thanks for the great work.</span></div>
        <Link href={payoutPath} style={outlineBtn}>Payout details</Link>
      </div>
    );
  } else if (s === "rejected" || s === "refunded") {
    decisionPanel = <div style={notice("bad")}>This proof wasn&apos;t approved, so this job won&apos;t be paid. Reply to our message if you think that&apos;s a mistake.</div>;
  } else {
    decisionPanel = <div style={notice("warn")}>This job is closed.</div>;
  }

  const city = job.location.address.split(",").slice(-2).join(",").trim();

  return (
    <div style={{ overflow: "hidden", background: "#ECE8DF" }}>
      <div style={{ color: "#232824", background: "#ECE8DF", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <SiteHeader />

        <div style={{ background: "#E9EFE4", borderBottom: "1px solid #DCE6D8" }}>
          <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "12px 24px", display: "flex", alignItems: "center", gap: "10px", fontSize: "14px", color: "#2F4A37" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}><path d="M4 5h16v11H8l-4 4z" /></svg>
            <span><strong>Matched for you.</strong> We sent you this job because it&apos;s near you{city ? ` in ${city}` : ""}.</span>
          </div>
        </div>

        <main style={{ flex: "1", width: "100%", maxWidth: "1240px", margin: "0 auto", boxSizing: "border-box", padding: "28px 24px 56px", display: "flex", flexWrap: "wrap", gap: "24px", alignItems: "flex-start" }}>
          <article style={{ flex: "999 1 560px", minWidth: "0", display: "flex", flexDirection: "column", gap: "18px" }}>
            <div style={{ background: "#FBF9F5", border: "1px solid #DCD6CA", borderRadius: "14px", overflow: "hidden" }}>
              <div style={{ padding: "26px 28px", background: "radial-gradient(120% 110% at 88% 0%, #43594A 0%, #26342B 42%, #151D17 100%)", display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: "18px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: "1 1 340px" }}>
                  <span style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", borderRadius: "999px", background: "#FBF9F5", color: "#2F4A37", fontSize: "13px", fontWeight: 600 }}>{job.category ?? "Job"}</span>
                  <h1 style={{ margin: "0", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "30px", lineHeight: 1.15, letterSpacing: "-0.035em", color: "#F3EEE4" }}>{job.title}</h1>
                  {job.company && (
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", fontSize: "14px", color: "#C3CBC2" }}>
                      <span aria-hidden="true" style={{ width: "26px", height: "26px", borderRadius: "7px", background: "#FBF9F5", color: "#46664F", fontSize: "12px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{job.company.charAt(0)}</span>
                      <strong>{job.company}</strong>
                      <span style={{ padding: "1px 7px", borderRadius: "6px", background: "#FBF9F5", color: "#4F5751", fontSize: "11px", fontWeight: 600 }}>AGENT CO.</span>
                      <span>· Business verified</span>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", fontWeight: 500, letterSpacing: "0.12em", color: "#C3CBC2" }}>YOU EARN</span>
                  <span style={{ fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "44px", lineHeight: 1, letterSpacing: "-0.035em", color: "#F3EEE4" }}>{usd(job.pay_usd)}</span>
                  <span style={{ fontSize: "14px", color: "#C3CBC2" }}>Flat · no fees</span>
                </div>
              </div>

              <div style={{ padding: "22px 28px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "18px", borderBottom: "1px solid #E3DED3" }}>
                <Fact icon={<><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>} k="Deadline" v={deadline.text.replace(/^By /, "")} sub={deadline.left} />
                <Fact icon={<><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>} k="Where" v={job.location.address} sub={<a href={mapsUrl(job.location.lat, job.location.lng)} target="_blank" rel="noreferrer noopener" style={{ color: "#3B5A44" }}>Open in Maps</a>} />
                <Fact icon={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>} k="Respond" v={s === "open" && can_accept ? "First yes gets it" : "Responded"} sub={s === "open" && can_accept ? "Others got this link too" : undefined} />
                <Fact icon={<><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>} k="Payment" v={`${usd(job.pay_usd)} held in escrow`} sub="Released when proof is approved" />
              </div>

              <div style={{ padding: "24px 28px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "26px" }}>
                <section style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <h2 style={sectionH}>What you&apos;ll do</h2>
                  <p style={{ margin: "0", fontSize: "15px", lineHeight: 1.55, color: "#3C443E", whiteSpace: "pre-wrap" }}>{job.instructions}</p>
                </section>
                <section style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <h2 style={sectionH}>Requirements</h2>
                  <ul style={listStyle}>
                    {job.certification_required && <li>{job.certification_required}</li>}
                    <li>A phone with a camera and location turned on</li>
                    <li>Verified identity on Operis</li>
                  </ul>
                </section>
                {req && (
                  <section style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <h2 style={sectionH}>Proof of completion</h2>
                    <ul style={listStyle}>
                      {req.photos && <li>At least {req.photos.min} photo{req.photos.min === 1 ? "" : "s"}{req.photos.must_show?.length ? ` showing: ${req.photos.must_show.join(", ")}` : ""}</li>}
                      {req.video && <li>A video of at least {req.video.min_seconds} seconds</li>}
                      {req.files && <li>Files: {req.files.kinds.join(", ")}</li>}
                      {job.location.lat != null && <li>Uploaded on site, within {req.geofence_m ?? 300} m of the job</li>}
                    </ul>
                  </section>
                )}
                <section style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <h2 style={sectionH}>Getting paid</h2>
                  <p style={{ margin: "0", fontSize: "15px", lineHeight: 1.55, color: "#3C443E" }}>Payment is released as soon as your proof is approved. You connect a bank account once, on your first payout.</p>
                </section>
              </div>
            </div>

            <a href={mapsUrl(job.location.lat, job.location.lng)} target="_blank" rel="noreferrer noopener" style={{ height: "200px", borderRadius: "14px", border: "1px solid #DCD6CA", background: "#ECE6DA", display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", color: "#4F5751", fontSize: "14px", fontWeight: 600, textDecoration: "none", textAlign: "center", padding: "0 16px" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#46664F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
              Map · {job.location.address} (opens in Maps)
            </a>
          </article>

          <aside aria-label="Your status and decision" style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <section aria-label="Verification" style={card}>
              {!loggedIn ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <h2 style={h2}>Are you cleared for this job?</h2>
                  <p style={{ margin: "0", fontSize: "14px", lineHeight: 1.55, color: "#4F5751" }}>Log in to check whether your identity{job.certification_required ? " and license are" : " is"} already verified.</p>
                  <Link href={loginHref} style={{ ...primaryBtn, minHeight: "46px" }}>Log in to check</Link>
                  <Link href={signupHref} style={{ fontSize: "14px", fontWeight: 600, textAlign: "center", textDecoration: "none", padding: "6px 0", color: "#3B5A44" }}>New to Operis? Create an account</Link>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <h2 style={{ ...h2, display: "flex", alignItems: "center", gap: "8px" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#46664F" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>
                    {cleared ? "You're cleared for this job" : "Finish verification for this job"}
                  </h2>
                  <ul style={{ listStyle: "none", margin: "0", padding: "0", display: "flex", flexDirection: "column", gap: "10px", fontSize: "14px" }}>
                    <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                      <Tick ok={idStatus === "verified"} />
                      <span><strong>{idStatus === "verified" ? "Identity verified" : idStatus === "processing" ? "Identity check in progress" : "Identity not verified yet"}</strong><br /><span style={{ color: "#5B635C" }}>{idStatus === "verified" ? "Checked by Stripe Identity" : <Link href={`/onboarding?step=1&next=${encodeURIComponent(jobPath)}`} style={{ color: "#3B5A44" }}>Verify your ID</Link>}</span></span>
                    </li>
                    {job.certification_required && (
                      <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                        <Tick ok={hasLicense} />
                        <span><strong>{job.certification_required}</strong><br /><span style={{ color: "#5B635C" }}>{hasLicense ? "Checked on state registry" : <Link href={`/onboarding?step=2&next=${encodeURIComponent(jobPath)}`} style={{ color: "#3B5A44" }}>Add your license</Link>}</span></span>
                      </li>
                    )}
                    <li style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                      <Tick ok />
                      {user ? (
                        <span><strong>Signed in as {user.name || user.email}</strong><br /><span style={{ color: "#5B635C" }}>Not you? Log out from the menu.</span></span>
                      ) : (
                        // only reached with NEXT_PUBLIC_WORKER_LOGIN=optional: the personal job link is the credential
                        <span><strong>Using your personal job link</strong><br /><span style={{ color: "#5B635C" }}>Don&apos;t share it; it&apos;s how we know the job is yours.</span></span>
                      )}
                    </li>
                  </ul>
                </div>
              )}
            </section>

            <section aria-label="Decision" style={card}>
              {decisionPanel}
              {error && <div role="alert" style={notice("bad")}>{error}</div>}
            </section>
          </aside>
        </main>
        <AuthFooter />
      </div>
    </div>
  );
}
