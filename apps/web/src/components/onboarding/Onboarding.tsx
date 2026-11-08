"use client";

// Port of the design's onboarding artboards (Onboarding.dc.html, steps 1–4 + done). Every field is
// saved to the worker's account (PATCH /v1/me) when they continue; ID verification is Stripe Identity.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api, postJson } from "@/lib/api";
import { patchMe, useSession, type User } from "@/lib/session";
import { LogoPill } from "@/components/SiteHeader";
import { ACCENT, FormError, Spinner, errorText } from "@/components/auth/ui";

const OB_STEPS = [
  { label: "Identity", sub: "Government ID and selfie" },
  { label: "Skills and licenses", sub: "What you can do" },
  { label: "Profiles and data", sub: "LinkedIn, links, permissions" },
  { label: "Contact and terms", sub: "Alerts and agreement" },
];
const OB_SKILLS = ["Legal", "Notary", "Accounting & tax", "Translation", "Presenting & events", "Photo & video", "Courier & delivery", "Field inspection", "Product testing"];
const LICENSE_TYPES = ["Bar license (attorney)", "Notary commission", "CPA license", "IRS Enrolled Agent", "ATA translator certification", "Other certificate"];
const STATES = ["California", "New York", "Texas", "Other"];

const field = { minHeight: "46px", padding: "0 14px", border: "1px solid #D2CCBF", borderRadius: "8px", background: "#F3F0E9", font: "inherit", fontSize: "15px", fontWeight: 400, color: "#232824" } as const;
const small = { ...field, minHeight: "44px", padding: "0 10px", fontSize: "14px" } as const;
const lab = { display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px", fontWeight: 600 } as const;
const h1 = { margin: "0", fontFamily: "var(--font-display)", fontWeight: 500, fontSize: "28px", letterSpacing: "-0.035em", color: "#1F2A22" } as const;
const lead = { margin: "0", fontSize: "15px", lineHeight: 1.6, color: "#4F5751" } as const;
const btn = { minHeight: "46px", padding: "0 22px", borderRadius: "8px", font: "inherit", fontSize: "15px", fontWeight: 600, cursor: "pointer" } as const;
const check = { flex: "none", width: "18px", height: "18px", marginTop: "2px", accentColor: ACCENT } as const;

const ID_TYPES = ["Driver's license", "Passport", "State ID card"];
const ID_LABEL: Record<string, string> = { unverified: "Not started", processing: "Checking with Stripe…", verified: "Verified", requires_input: "Needs another try" };

export default function Onboarding({ startStep, next }: { startStep: number; next: string }) {
  const router = useRouter();
  const { user, loading, setUser, refresh } = useSession();
  const [step, setStep] = useState(startStep);
  const [d, setD] = useState<User | null>(null); // local draft of the account
  const [idType, setIdType] = useState(ID_TYPES[0]!);
  const [lic, setLic] = useState({ type: LICENSE_TYPES[1]!, state: STATES[0]!, number: "", certificate: "" as string });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agreedLocal, setAgreedLocal] = useState(false);
  const certInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(`/onboarding?step=${step}`)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  useEffect(() => {
    if (user && !d) {
      setD(user);
      if (user.identity.id_type) setIdType(user.identity.id_type);
    }
  }, [user, d]);

  // Keep the step in the URL so returning from Stripe or LinkedIn lands on the right one.
  useEffect(() => {
    const qs = new URLSearchParams({ step: String(step) });
    if (next !== "/jobs") qs.set("next", next);
    window.history.replaceState(null, "", `/onboarding?${qs}`);
  }, [step, next]);

  // Stripe reports the result a few seconds after the worker comes back: poll until it settles.
  const idStatus = user?.identity.status;
  useEffect(() => {
    if (idStatus !== "processing") return;
    const t = setInterval(async () => {
      const u = await refresh();
      if (u) setD((prev) => (prev ? { ...prev, identity: u.identity } : u));
    }, 2500);
    return () => clearInterval(t);
  }, [idStatus, refresh]);

  if (!user || !d) return <div style={{ minHeight: "calc(100vh - 24px)", background: "#ECE8DF" }} aria-busy="true" />;

  const done = step === 5;
  const ret = (s: number) => `/onboarding?step=${s}${next !== "/jobs" ? `&next=${encodeURIComponent(next)}` : ""}`;

  async function save(patch: Record<string, unknown>) {
    const r = await patchMe(patch);
    if (r.ok) {
      setUser(r.data.user);
      setD(r.data.user);
    }
    return r;
  }

  function stepPatch(s: number): Record<string, unknown> {
    if (s === 2) return { skills: d!.skills };
    if (s === 3) return { profiles: { portfolio_url: d!.profiles.portfolio_url, other_url: d!.profiles.other_url }, permissions: d!.permissions };
    if (s === 4) return { alerts: d!.alerts, min_pay: d!.min_pay, radius: d!.radius, quiet_hours: d!.quiet_hours };
    return {};
  }

  async function go(to: number) {
    setError(null);
    setBusy("nav");
    const r = await save({ ...stepPatch(step), onboarding_step: Math.max(d!.onboarding_step, Math.min(to, 4)), ...(to === 5 ? { agreed_terms: true, onboarding_done: true } : {}) });
    setBusy(null);
    if (!r.ok) return setError(errorText(r.error));
    setStep(to);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function finishLater() {
    setBusy("later");
    await save({ ...stepPatch(step), onboarding_step: Math.max(d!.onboarding_step, step) });
    router.push(next);
  }

  async function startIdentity() {
    setBusy("identity");
    setError(null);
    const r = await postJson<{ url: string }>("/v1/me/identity/session", { id_type: idType, return_url: ret(1) });
    if (!r.ok || !r.data.url) {
      setBusy(null);
      return setError(errorText(r.ok ? "unknown" : r.error));
    }
    window.location.assign(r.data.url); // Stripe-hosted capture of ID front/back and a live selfie
  }

  async function addLicense() {
    if (!lic.number.trim()) return setError("Enter the license number so we can check the registry.");
    setBusy("license");
    setError(null);
    const r = await postJson<{ user: User }>("/v1/me/licenses", { ...lic, certificate: lic.certificate || null });
    setBusy(null);
    if (!r.ok) return setError(errorText(r.error));
    setUser(r.data.user);
    setD((prev) => (prev ? { ...prev, licenses: r.data.user.licenses } : r.data.user));
    setLic({ ...lic, number: "", certificate: "" });
  }

  async function removeLicense(id: string) {
    const r = await api<{ user: User }>(`/v1/me/licenses/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.ok) {
      setUser(r.data.user);
      setD((prev) => (prev ? { ...prev, licenses: r.data.user.licenses } : r.data.user));
    }
  }

  async function disconnectLinkedin() {
    const r = await api<{ user: User }>("/v1/me/linkedin", { method: "DELETE" });
    if (r.ok) {
      setUser(r.data.user);
      setD((prev) => (prev ? { ...prev, profiles: { ...prev.profiles, linkedin: null } } : r.data.user));
    }
  }

  const status = user.identity.status;
  const idSubmitted = status === "processing" || status === "verified";
  const agreed = !!d.agreed_terms_at || agreedLocal;
  const nextDisabled = (step === 4 && !agreed) || (step === 1 && !idSubmitted);
  const drop = (on: boolean) => ({ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px", minHeight: "150px", padding: "16px", borderRadius: "14px", font: "inherit", textAlign: "center", cursor: "pointer", ...(on ? { border: "1.5px solid #46664F", background: "#EEF3EB", color: "#2F4A37" } : { border: "1.5px dashed #C5BEB0", background: "#F3F0E9", color: "#46664F" }) }) as const;
  const tileLabel = (base: string) => (status === "verified" ? `${base} verified` : status === "processing" ? `${base} submitted` : status === "requires_input" ? `Retake ${base.toLowerCase()}` : `Upload ${base.toLowerCase()}`);

  return (
    <div style={{ borderRadius: "22px", overflow: "hidden", background: "#ECE8DF" }}>
      <div style={{ color: "#232824", background: "#ECE8DF", minHeight: "calc(100vh - 24px)", display: "flex", flexDirection: "column" }}>
        <header style={{ position: "relative", zIndex: 5, background: "#ECE8DF" }}>
          <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "16px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px 24px" }}>
            <LogoPill />
            <div style={{ display: "flex", alignItems: "center", gap: "18px", fontSize: "14px", color: "#4F5751" }}>
              <span>{done ? "All steps complete" : `Step ${step} of 4`}</span>
              {!done && (
                <button type="button" onClick={finishLater} disabled={busy !== null} style={{ display: "inline-flex", alignItems: "center", gap: "8px", minHeight: "44px", padding: "0 16px", borderRadius: "8px", background: "#FFFFFF", border: "1px solid #DCD6CA", color: "#1F2A22", font: "inherit", fontSize: "14px", fontWeight: 500, cursor: "pointer" }}>
                  {busy === "later" && <Spinner />}Save and finish later
                </button>
              )}
            </div>
          </div>
          <div aria-hidden="true" style={{ height: "4px", background: "#E2DDD2" }}><div style={{ height: "4px", background: ACCENT, width: `${done ? 100 : (step - 1) * 25 + 8}%`, transition: "width 0.3s" }} /></div>
        </header>

        <main style={{ flex: "1", width: "100%", maxWidth: "1180px", margin: "0 auto", boxSizing: "border-box", padding: "36px 24px 56px", display: "flex", flexWrap: "wrap", gap: "28px", alignItems: "flex-start" }}>
          <nav aria-label="Onboarding steps" style={{ flex: "1 1 240px", background: "radial-gradient(130% 110% at 90% 0%, #43594A 0%, #26342B 45%, #151D17 100%)", borderRadius: "14px", padding: "18px 14px 14px", display: "flex", flexDirection: "column", gap: "4px", color: "#F3EEE4" }}>
            <span style={{ padding: "2px 10px 10px", fontFamily: "var(--font-mono)", fontSize: "11px", fontWeight: 500, letterSpacing: "0.12em", color: "#C3CBC2" }}>YOUR VERIFICATION</span>
            {OB_STEPS.map((st, i) => {
              const n = i + 1;
              const isCur = n === step;
              const isDone = n < step || done;
              return (
                <button key={st.label} type="button" onClick={() => go(n)} disabled={busy !== null} aria-current={isCur ? "step" : undefined} style={{ display: "flex", alignItems: "center", gap: "12px", width: "100%", minHeight: "56px", padding: "8px 10px", border: "0", borderRadius: "12px", font: "inherit", cursor: "pointer", background: isCur ? "rgba(243,238,228,0.12)" : "transparent" }}>
                  <span style={{ flex: "none", width: "30px", height: "30px", borderRadius: "999px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 700, ...(isCur || isDone ? { background: "#A9C0A2", color: "#151D17" } : { background: "#2C3B31", color: "#C3CBC2" }) }}>{isDone ? "✓" : n}</span>
                  <span style={{ display: "flex", flexDirection: "column", gap: "2px", textAlign: "left" }}>
                    <span style={{ fontSize: "15px", fontWeight: 600, color: "#F3EEE4" }}>{st.label}</span>
                    <span style={{ fontSize: "13px", color: "#C3CBC2" }}>{st.sub}</span>
                  </span>
                </button>
              );
            })}
            <div style={{ marginTop: "10px", padding: "12px", borderRadius: "12px", background: "rgba(243, 238, 228, 0.08)", fontSize: "13px", lineHeight: 1.5, color: "#C3CBC2" }}>
              You can change anything here later in <Link href="/account" style={{ color: "#F3EEE4" }}>Settings</Link>, including what we&apos;re allowed to look at.
            </div>
          </nav>

          <section aria-label="Current step" style={{ flex: "999 1 560px", minWidth: "0", background: "#FBF9F5", border: "1px solid #DCD6CA", borderRadius: "14px", padding: "32px", display: "flex", flexDirection: "column", gap: "24px" }}>
            {step === 1 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <h1 style={h1}>Verify your identity</h1>
                  <p style={lead}>Agent companies only hire verified people. Upload a government-issued photo ID and take a quick selfie so we can confirm it&apos;s you.</p>
                </div>
                <label style={{ ...lab, maxWidth: "360px" }}>ID type
                  <select value={idType} onChange={(e) => setIdType(e.target.value)} disabled={idSubmitted} style={{ ...field, padding: "0 12px" }}>
                    {ID_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px" }}>
                  <button type="button" onClick={startIdentity} disabled={idSubmitted || busy !== null} style={drop(idSubmitted)}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M14 10h4M14 14h4M6 16c.5-1.5 1.7-2 3-2s2.5.5 3 2" /></svg>
                    <span style={{ fontWeight: 600, fontSize: "15px" }}>{tileLabel("Front")}</span>
                    <span style={{ fontSize: "13px", color: "#5B635C" }}>Front of ID · photo with your camera</span>
                  </button>
                  <button type="button" onClick={startIdentity} disabled={idSubmitted || busy !== null || idType === "Passport"} style={{ ...drop(idSubmitted), ...(idType === "Passport" ? { opacity: 0.5, cursor: "default" } : {}) }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M7 14h6" /></svg>
                    <span style={{ fontWeight: 600, fontSize: "15px" }}>{idType === "Passport" ? "Not needed" : tileLabel("Back")}</span>
                    <span style={{ fontSize: "13px", color: "#5B635C" }}>Back of ID · skip for passports</span>
                  </button>
                  <button type="button" onClick={startIdentity} disabled={idSubmitted || busy !== null} style={drop(idSubmitted)}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="4" /><path d="M5 21c1-4 4-6 7-6s6 2 7 6" /></svg>
                    <span style={{ fontWeight: 600, fontSize: "15px" }}>{status === "verified" ? "Selfie matched" : status === "processing" ? "Selfie submitted" : "Take a selfie"}</span>
                    <span style={{ fontSize: "13px", color: "#5B635C" }}>Live photo with your camera</span>
                  </button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: 600, color: status === "verified" ? "#2F4A37" : status === "requires_input" ? "#A12A22" : "#4F5751" }}>
                    {status === "processing" && <Spinner />}Status: {ID_LABEL[status]}
                  </span>
                  {!idSubmitted && (
                    <button type="button" onClick={startIdentity} disabled={busy !== null} style={{ ...btn, border: "0", background: ACCENT, color: "#FFFFFF", display: "inline-flex", alignItems: "center", gap: "8px" }}>
                      {busy === "identity" && <Spinner />}{status === "requires_input" ? "Try again with Stripe" : "Start verification"}
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", padding: "14px 16px", borderRadius: "12px", background: "#EEF3EB", fontSize: "14px", lineHeight: 1.5, color: "#34503D" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", marginTop: "2px" }}><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /></svg>
                  <span>Your ID is checked by Stripe Identity. You&apos;ll take the photos on Stripe&apos;s secure page, then come back here. Agent companies see only that you&apos;re verified, never your ID.</span>
                </div>
              </div>
            )}

            {step === 2 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <h1 style={h1}>Skills and licenses</h1>
                  <p style={lead}>Pick the kinds of work you want. For licensed work, add your license and we&apos;ll check it against the official registry.</p>
                </div>
                <fieldset style={{ border: "0", margin: "0", padding: "0", display: "flex", flexDirection: "column", gap: "10px" }}>
                  <legend style={{ padding: "0 0 10px", fontSize: "14px", fontWeight: 600 }}>Work you&apos;re interested in</legend>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {OB_SKILLS.map((label) => {
                      const on = d.skills.includes(label);
                      return (
                        <button key={label} type="button" aria-pressed={on} onClick={() => setD((p) => p && { ...p, skills: p.skills.includes(label) ? p.skills.filter((x) => x !== label) : [...p.skills, label] })} style={{ minHeight: "40px", padding: "0 14px", borderRadius: "999px", font: "inherit", fontSize: "14px", fontWeight: 600, cursor: "pointer", ...(on ? { border: `1px solid ${ACCENT}`, background: ACCENT, color: "#FFFFFF" } : { border: "1px solid #D2CCBF", background: "#FBF9F5", color: "#2B302C" }) }}>{label}</button>
                      );
                    })}
                  </div>
                </fieldset>

                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <span style={{ fontSize: "14px", fontWeight: 600 }}>Licenses and certificates</span>
                  {d.licenses.map((l) => (
                    <div key={l.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", padding: "14px 16px", border: `1px solid ${l.status === "active" ? "#DCE6D8" : "#EBC9C4"}`, borderRadius: "12px", background: l.status === "active" ? "#F4F8F1" : "#FBF0EE" }}>
                      <span style={{ flex: "none", width: "38px", height: "38px", borderRadius: "8px", background: "#E2EADE", color: "#46664F", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 3h6v5l3 4H6l3-4zM5 16h14v3H5zM4 21h16" /></svg></span>
                      <span style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: "2px" }}>
                        <strong style={{ fontSize: "15px" }}>{l.state && l.state !== "Other" ? `${l.state} ` : ""}{l.type.toLowerCase()}</strong>
                        <span style={{ fontSize: "13px", color: "#4F5751" }}>#{l.number}{l.expires && l.status === "active" ? ` · expires ${l.expires}` : ""}{l.certificate ? ` · ${l.certificate}` : ""}</span>
                      </span>
                      {l.status === "active" ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "5px 10px", borderRadius: "8px", background: "#E2EADE", color: "#2F4A37", fontSize: "13px", fontWeight: 600 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>Active on {l.state ?? "state"} registry · {new Date(l.checked_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                      ) : (
                        <span style={{ padding: "5px 10px", borderRadius: "8px", background: "#F6E1DE", color: "#A12A22", fontSize: "13px", fontWeight: 600 }}>Not found on the registry. Check the number.</span>
                      )}
                      <button type="button" onClick={() => removeLicense(l.id)} style={{ minHeight: "36px", padding: "0 10px", border: "0", background: "transparent", color: "#3B5A44", font: "inherit", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>Remove</button>
                    </div>
                  ))}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "12px", padding: "16px", border: "1px dashed #C5BEB0", borderRadius: "12px" }}>
                    <label style={{ ...lab, fontSize: "13px" }}>License type
                      <select value={lic.type} onChange={(e) => setLic({ ...lic, type: e.target.value })} style={small}>{LICENSE_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                    </label>
                    <label style={{ ...lab, fontSize: "13px" }}>Issuing state
                      <select value={lic.state} onChange={(e) => setLic({ ...lic, state: e.target.value })} style={small}>{STATES.map((t) => <option key={t}>{t}</option>)}</select>
                    </label>
                    <label style={{ ...lab, fontSize: "13px" }}>License number
                      <input type="text" placeholder="e.g. 123456" value={lic.number} onChange={(e) => setLic({ ...lic, number: e.target.value })} style={{ ...small, padding: "0 12px" }} />
                    </label>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: "8px" }}>
                      <button type="button" onClick={() => certInput.current?.click()} style={{ flex: "1", minHeight: "44px", border: "1px solid #C5BEB0", borderRadius: "8px", background: "#FBF9F5", font: "inherit", fontSize: "14px", fontWeight: 600, color: "#232824", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0 8px" }}>
                        {lic.certificate ? `✓ ${lic.certificate}` : "Upload certificate"}
                      </button>
                      <input ref={certInput} type="file" accept="image/*,application/pdf" className="hidden-input" tabIndex={-1} aria-hidden="true" onChange={(e) => setLic({ ...lic, certificate: e.target.files?.[0]?.name ?? "" })} />
                    </div>
                  </div>
                  <button type="button" onClick={addLicense} disabled={busy !== null} style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "8px", minHeight: "44px", padding: "0 16px", border: "0", borderRadius: "8px", background: "#E2EADE", color: "#2F4A37", font: "inherit", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>
                    {busy === "license" ? <Spinner /> : "+"} Add license and check registry
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <h1 style={h1}>Profiles and data permissions</h1>
                  <p style={lead}>Connecting your profiles helps us match you to better jobs. Nothing here is required, and each permission is separate.</p>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "14px", padding: "16px", border: "1px solid #DCD6CA", borderRadius: "14px", background: "#F3F0E9" }}>
                  <span style={{ flex: "none", width: "44px", height: "44px", borderRadius: "8px", background: "#E2DDD2", color: "#2F4A37", fontWeight: 800, fontSize: "17px", display: "flex", alignItems: "center", justifyContent: "center" }}>in</span>
                  <span style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: "2px" }}>
                    <strong style={{ fontSize: "15px" }}>LinkedIn</strong>
                    <span style={{ fontSize: "13px", color: "#4F5751" }}>{d.profiles.linkedin ? `Connected as ${d.profiles.linkedin.name}. We can read your headline, experience and skills.` : "Sign in with LinkedIn to share your experience. You approve what is shared."}</span>
                  </span>
                  {d.profiles.linkedin ? (
                    <button type="button" onClick={disconnectLinkedin} style={{ ...btn, border: "1px solid #C5BEB0", background: "#FBF9F5", color: "#232824" }}>Disconnect</button>
                  ) : (
                    <a href={`/api/v1/me/linkedin/start?return=${encodeURIComponent(ret(3))}`} onClick={async (e) => { e.preventDefault(); const href = e.currentTarget.href; await save(stepPatch(3)); window.location.assign(href); }} style={{ ...btn, border: "0", background: ACCENT, color: "#FFFFFF", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Connect LinkedIn</a>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
                  <label style={lab}>Portfolio or website
                    <input type="url" placeholder="https://" value={d.profiles.portfolio_url} onChange={(e) => setD({ ...d, profiles: { ...d.profiles, portfolio_url: e.target.value } })} style={field} />
                  </label>
                  <label style={lab}>Other profile (GitHub, Behance, etc.)
                    <input type="url" placeholder="https://" value={d.profiles.other_url} onChange={(e) => setD({ ...d, profiles: { ...d.profiles, other_url: e.target.value } })} style={field} />
                  </label>
                </div>
                <fieldset style={{ border: "1px solid #DCD6CA", borderRadius: "14px", margin: "0", padding: "18px", display: "flex", flexDirection: "column", gap: "14px" }}>
                  <legend style={{ padding: "0 6px", fontSize: "14px", fontWeight: 600 }}>What Operis may do</legend>
                  {([
                    ["read_profiles", "Read the profiles and links I add", " to understand my experience and suggest jobs."],
                    ["search_public", "Search public sources about me", ", like licensing boards, professional directories and my public web pages, to confirm my skills."],
                    ["learn_choices", "Learn from my accept and decline choices", " to improve the jobs I'm sent."],
                  ] as const).map(([k, strong, rest]) => (
                    <label key={k} style={{ display: "flex", gap: "12px", alignItems: "flex-start", fontSize: "14px", lineHeight: 1.5, cursor: "pointer" }}>
                      <input type="checkbox" checked={d.permissions[k]} onChange={(e) => setD({ ...d, permissions: { ...d.permissions, [k]: e.target.checked } })} style={check} />
                      <span><strong>{strong}</strong>{rest}</span>
                    </label>
                  ))}
                </fieldset>
              </div>
            )}

            {step === 4 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <h1 style={h1}>How we reach you</h1>
                  <p style={lead}>When an agent company posts a job that fits you, we&apos;ll send it here. Every message links to the job so you can accept or pass.</p>
                </div>
                <fieldset style={{ border: "0", margin: "0", padding: "0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "10px" }}>
                  <legend style={{ padding: "0 0 10px", fontSize: "14px", fontWeight: 600 }}>Send job alerts by</legend>
                  {([
                    ["sms", "Text message", d.phone || "Add a phone in Settings"],
                    ["email", "Email", d.email],
                    ["call", "Phone call", "Urgent jobs only"],
                  ] as const).map(([k, t, sub]) => (
                    <label key={k} style={{ display: "flex", gap: "10px", alignItems: "center", minHeight: "52px", padding: "0 14px", border: "1px solid #D2CCBF", borderRadius: "12px", background: "#F3F0E9", fontSize: "14px", cursor: "pointer" }}>
                      <input type="checkbox" checked={d.alerts[k]} onChange={(e) => setD({ ...d, alerts: { ...d.alerts, [k]: e.target.checked } })} style={{ width: "18px", height: "18px", accentColor: ACCENT }} />
                      <span><strong>{t}</strong><br /><span style={{ color: "#5B635C" }}>{sub}</span></span>
                    </label>
                  ))}
                </fieldset>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
                  <label style={lab}>Minimum pay
                    <input type="text" inputMode="decimal" placeholder="$ per hour" value={d.min_pay} onChange={(e) => setD({ ...d, min_pay: e.target.value })} style={field} />
                  </label>
                  <label style={lab}>How far you&apos;ll travel
                    <select value={d.radius} onChange={(e) => setD({ ...d, radius: e.target.value })} style={{ ...field, padding: "0 12px" }}><option>Remote only</option><option>Up to 10 miles</option><option>Up to 25 miles</option><option>Up to 50 miles</option></select>
                  </label>
                  <label style={lab}>Quiet hours
                    <select value={d.quiet_hours} onChange={(e) => setD({ ...d, quiet_hours: e.target.value })} style={{ ...field, padding: "0 12px" }}><option>9 PM – 8 AM</option><option>10 PM – 7 AM</option><option>None</option></select>
                  </label>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "18px", borderRadius: "14px", background: "#E5E1D7" }}>
                  <label style={{ display: "flex", gap: "12px", alignItems: "flex-start", fontSize: "14px", lineHeight: 1.5, cursor: "pointer" }}>
                    <input type="checkbox" checked={agreed} disabled={!!d.agreed_terms_at} onChange={(e) => setAgreedLocal(e.target.checked)} style={check} />
                    <span>I agree to the <Link href="/terms" target="_blank" style={{ color: "#3B5A44" }}>Worker Terms</Link> and <Link href="/privacy" target="_blank" style={{ color: "#3B5A44" }}>Privacy Policy</Link>, and I understand I work as an independent contractor and choose which jobs to accept.</span>
                  </label>
                </div>
              </div>
            )}

            {done && (
              <div style={{ display: "flex", flexDirection: "column", gap: "18px", alignItems: "flex-start" }}>
                <span style={{ width: "56px", height: "56px", borderRadius: "14px", background: "#E2EADE", color: "#2F4A37", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg></span>
                <h1 style={{ ...h1, fontSize: "30px" }}>You&apos;re set up</h1>
                <p style={{ ...lead, maxWidth: "560px" }}>{status === "verified" ? "Your ID is verified." : "Your ID check usually finishes within minutes."} We&apos;ll text or email you as soon as an agent company posts a job that fits.</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                  <Link href={next.startsWith("/j/") ? next : "/j/demo"} style={{ display: "inline-flex", alignItems: "center", minHeight: "48px", padding: "0 20px", borderRadius: "8px", background: ACCENT, color: "#FFFFFF", fontSize: "15px", fontWeight: 600, textDecoration: "none" }}>{next.startsWith("/j/") ? "Back to your job" : "See a job matched to you"}</Link>
                  <Link href="/jobs" style={{ display: "inline-flex", alignItems: "center", minHeight: "48px", padding: "0 20px", borderRadius: "8px", border: "1px solid #C5BEB0", background: "#FBF9F5", color: "#232824", fontSize: "15px", fontWeight: 600, textDecoration: "none" }}>Browse all requests</Link>
                </div>
              </div>
            )}

            <FormError>{error}</FormError>

            {!done && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", paddingTop: "18px", borderTop: "1px solid #E3DED3", flexWrap: "wrap" }}>
                <button type="button" onClick={() => go(step - 1)} disabled={step === 1 || busy !== null} style={{ ...btn, border: "1px solid #C5BEB0", background: "#FBF9F5", color: "#232824", ...(step === 1 ? { opacity: 0.45, cursor: "default" } : {}) }}>Back</button>
                <span style={{ flex: "1", textAlign: "right", fontSize: "13px", color: "#5B635C" }}>
                  {step === 1 && !idSubmitted ? "Start verification to continue" : step === 4 && !agreed ? "Agree to the terms to finish" : ""}
                </span>
                <button type="button" onClick={() => go(step + 1)} disabled={nextDisabled || busy !== null} style={{ ...btn, border: "0", color: "#FFFFFF", display: "inline-flex", alignItems: "center", gap: "8px", background: nextDisabled ? "#8FA394" : ACCENT, ...(nextDisabled ? { cursor: "not-allowed" } : {}) }}>
                  {busy === "nav" && <Spinner />}{step === 4 ? "Finish setup" : "Continue"}
                </button>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
