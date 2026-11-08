// Worker job page (fallback until Dora's web app ships): see the job, accept, upload proof, set up payout.
// Calls the same /v1/worker/* endpoints Dora's pages will use.
"use client";
import { use, useEffect, useState } from "react";

type Data = {
  job: { title: string; instructions: string; location: { address: string; lat: number | null; lng: number | null }; deadline: string; pay_usd: number;
         certification_required: string | null; proof_requirement: any };
  state: string; can_accept: boolean; can_upload_proof: boolean;
};

const box: React.CSSProperties = { background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,.08)", marginBottom: 16 };
const btn = (bg: string): React.CSSProperties => ({ background: bg, color: "#fff", border: 0, borderRadius: 12, padding: "14px 18px", fontSize: 16, fontWeight: 600, width: "100%", marginTop: 8, cursor: "pointer" });

async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 3_500_000) return file; // keep originals (EXIF) when small enough
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.85));
  return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg", lastModified: file.lastModified });
}

export default function JobPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => fetch(`/v1/worker/jobs/${token}`).then(async (r) => (r.ok ? setData(await r.json()) : setErr("This job link is invalid or has expired.")));
  useEffect(() => { load(); }, []);

  const act = async (path: string) => {
    setBusy(true);
    const r = await fetch(`/v1/worker/jobs/${token}/${path}`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? (path === "accept" ? "You got the job! Do the task, then upload your proof below." : "No problem, thanks for letting us know.") : j.error === "already_taken_or_closed" ? "Sorry, someone else already took this job." : "Something went wrong. Try again.");
    setBusy(false); load();
  };

  const locate = () => navigator.geolocation.getCurrentPosition(
    (p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => setMsg("We need your location to verify you were on site. Allow location access and try again."),
    { enableHighAccuracy: true, timeout: 15000 },
  );

  const submit = async () => {
    if (!files.length) return setMsg("Add at least one photo or file.");
    setBusy(true); setMsg("Uploading…");
    const form = new FormData();
    for (const f of files) form.append("files", await shrink(f));
    if (gps) { form.append("gps_lat", String(gps.lat)); form.append("gps_lng", String(gps.lng)); }
    form.append("captured_at", new Date(Math.max(...files.map((f) => f.lastModified || Date.now()))).toISOString());
    const r = await fetch(`/v1/worker/jobs/${token}/proof`, { method: "POST", body: form });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? "Proof received! We'll check it and pay you once it's approved." : `Upload failed: ${j.error ?? r.status}`);
    setBusy(false); load();
  };

  const payout = async () => {
    const r = await fetch(`/v1/worker/payout-setup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    const j = await r.json().catch(() => ({}));
    if (j.url) window.location.href = j.url; else setMsg(j.note ?? "Payout setup isn't available yet.");
  };

  if (err) return <Shell><div style={box}>{err}</div></Shell>;
  if (!data) return <Shell><div style={box}>Loading…</div></Shell>;
  const { job } = data;
  const need = job.proof_requirement?.photos;
  return (
    <Shell>
      <div style={box}>
        <div style={{ fontSize: 13, color: "#666", letterSpacing: 1 }}>JOB · ${job.pay_usd.toFixed(2)}</div>
        <h1 style={{ fontSize: 24, margin: "6px 0 10px" }}>{job.title}</h1>
        <p style={{ whiteSpace: "pre-wrap", margin: "0 0 12px" }}>{job.instructions}</p>
        <div>📍 {job.location.address}{job.location.lat != null && <> · <a href={`https://maps.google.com/?q=${job.location.lat},${job.location.lng}`}>map</a></>}</div>
        <div>⏰ by {new Date(job.deadline).toLocaleString()}</div>
        {job.certification_required && <div>🎓 Requires: {job.certification_required}</div>}
        {need && <div>📸 Proof: {need.min}+ photos showing {need.must_show?.join(", ")}</div>}
      </div>

      {msg && <div style={{ ...box, background: "#eef6ff" }}>{msg}</div>}

      {data.can_accept && (
        <div style={box}>
          <button disabled={busy} style={btn("#111")} onClick={() => act("accept")}>Yes, I'll do it</button>
          <button disabled={busy} style={btn("#999")} onClick={() => act("decline")}>No thanks</button>
          <p style={{ fontSize: 13, color: "#666" }}>First person to accept gets the job. You do the work in your own name; we never ask you to sign anything or log in as anyone.</p>
        </div>
      )}

      {data.can_upload_proof && (
        <div style={box}>
          <h2 style={{ fontSize: 18, marginTop: 0 }}>Upload your proof</h2>
          <input type="file" accept="image/*,video/*,application/pdf" multiple capture="environment" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          <div style={{ margin: "10px 0" }}>{files.length} file(s) selected</div>
          <button style={btn(gps ? "#0a7" : "#335")} onClick={locate}>{gps ? `📍 Location added (${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)})` : "📍 Add my location"}</button>
          <button disabled={busy} style={btn("#111")} onClick={submit}>Submit proof</button>
        </div>
      )}

      {["approved", "paid", "proof_submitted"].includes(data.state) && !data.can_upload_proof && (
        <div style={box}>
          <div>Status: <b>{data.state.replace("_", " ")}</b></div>
          <button style={btn("#635bff")} onClick={payout}>Set up payout (bank account)</button>
        </div>
      )}
      {data.state === "unavailable" && <div style={box}>This job is no longer available.</div>}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ background: "#f5f5f7", minHeight: "100vh", padding: "24px 16px" }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        <div style={{ fontWeight: 800, letterSpacing: 2, marginBottom: 16 }}>OPERIS</div>
        {children}
      </div>
    </main>
  );
}
