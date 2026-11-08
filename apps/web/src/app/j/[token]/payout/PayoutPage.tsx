"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { getJob, payoutSetup, type WorkerJob } from "@/lib/api";
import { usd } from "@/lib/format";
import Icon from "@/components/Icon";
import { Expired, Loading, Offline, Shell } from "@/components/ui";

export default function PayoutPage({ token }: { token: string }) {
  const [load, setLoad] = useState<"loading" | "expired" | "offline" | WorkerJob>("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const r = await getJob(token);
    setLoad(r.ok ? r.data : r.status === 404 ? "expired" : "offline");
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function connect() {
    setBusy(true);
    setError(null);
    setNote(null);
    const r = await payoutSetup(token);
    if (r.ok && r.data.url) {
      window.location.assign(r.data.url); // Stripe Connect onboarding; Stripe sends them back here
      return;
    }
    if (r.ok) setNote("Bank setup isn't switched on yet. Your pay is safe; we'll text you a link as soon as it's ready.");
    else if (r.status === 404) return setLoad("expired");
    else setError("We couldn't reach Operis. Check your signal and try again.");
    setBusy(false);
  }

  if (load === "loading") return <Loading />;
  if (load === "expired") return <Expired />;
  if (load === "offline") return <Offline retry={() => { setLoad("loading"); refresh(); }} />;

  const paid = load.state === "paid";
  const eligible = load.state === "approved" || paid;
  const jobPath = `/j/${encodeURIComponent(token)}`;

  return (
    <Shell
      bar={
        eligible ? (
          <button className="btn" onClick={connect} disabled={busy}>
            {busy ? <><span className="spinner" /> Opening Stripe…</> : <><Icon name="bank" /> {paid ? "Manage bank account" : "Connect bank account"}</>}
          </button>
        ) : (
          <Link className="btn secondary" href={jobPath}>Back to the job</Link>
        )
      }
    >
      <Link href={jobPath} className="small row" style={{ gap: 4 }}><Icon name="arrowLeft" size={16} /> {load.job.title}</Link>

      <article className="card flush">
        <div className="hero">
          <span className="eyebrow">{paid ? "Paid" : eligible ? "Ready to pay out" : "Payout"}</span>
          <span className="pay">{usd(load.job.pay_usd)}</span>
          <span className="small">{paid ? "Sent to your bank account." : eligible ? "Approved. Connect a bank account to receive it." : "Available once your proof is approved."}</span>
        </div>
        <div className="section stack">
          <h2>How payouts work</h2>
          <ul className="facts">
            <li><span className="ic"><Icon name="shield" /></span><div>Bank details go straight to <strong>Stripe</strong>, our payments partner. Operis never sees your account number.</div></li>
            <li><span className="ic"><Icon name="clock" /></span><div>You set it up once, on your first payout. Future jobs pay out automatically.</div></li>
            <li><span className="ic"><Icon name="check" /></span><div>No fees for you. You get the full amount shown.</div></li>
          </ul>
        </div>
      </article>

      {!eligible && <div className="notice info">This job isn&apos;t approved yet, so there&apos;s nothing to pay out.</div>}
      {note && <div className="notice info" role="status">{note}</div>}
      {error && <div className="notice bad" role="alert">{error}</div>}
    </Shell>
  );
}
