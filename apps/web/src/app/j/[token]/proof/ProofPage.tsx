"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

import { getJob, submitProof, type ProofBody, type WorkerJob } from "@/lib/api";
import { distanceM, mapsUrl, meters } from "@/lib/format";
import { GEO_HELP, getFix, type Fix, type GeoError } from "@/lib/geo";
import Icon from "@/components/Icon";
import { Expired, Loading, Message, Offline, Shell } from "@/components/ui";

type Role = "photo" | "video" | "file" | "certification";

interface Item {
  id: string;
  role: Role;
  file: File;
  preview: string | null;
  /** Set once the original bytes are stored, so a retry never re-uploads. */
  url: string | null;
  progress: number;
  status: "ready" | "uploading" | "done" | "error";
  durationS?: number;
}

type Phase = "edit" | "locating" | "uploading" | "submitting" | "error";

const STALE_MS = 6 * 3_600_000; // the Verifier flags proof older than 6 hours
const INLINE_LIMIT = 3 * 1024 * 1024; // without Blob, everything rides in one JSON body (Vercel caps at 4.5 MB)

export default function ProofPage({ token }: { token: string }) {
  const [load, setLoad] = useState<"loading" | "expired" | "offline" | WorkerJob>("loading");
  const [items, setItems] = useState<Item[]>([]);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [fields, setFields] = useState<Record<string, string>>({});
  const [fix, setFix] = useState<Fix | null>(null);
  const [geoErr, setGeoErr] = useState<GeoError | null>(null);
  const [phase, setPhase] = useState<Phase>("edit");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [blobEnabled, setBlobEnabled] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    const r = await getJob(token);
    if (r.ok) setLoad(r.data);
    else setLoad(r.status === 404 ? "expired" : "offline");
    return r;
  }, [token]);

  useEffect(() => {
    refresh();
    fetch(`/j/${encodeURIComponent(token)}/upload`, { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => setBlobEnabled(Boolean(b.enabled)))
      .catch(() => setBlobEnabled(false));
  }, [refresh, token]);

  const locate = useCallback(async () => {
    setGeoErr(null);
    try {
      const f = await getFix();
      setFix(f);
      return f;
    } catch (e) {
      setGeoErr(e as GeoError);
      return null;
    }
  }, []);

  // Ask for location right away so a denied permission shows up before they take photos.
  useEffect(() => {
    locate();
  }, [locate]);

  // Revoke preview URLs on unmount.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => () => itemsRef.current.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)), []);

  const job = typeof load === "object" ? load.job : null;
  const req = job?.proof_requirement ?? null;
  // Same rule as the API (services/money-verification/src/proof/checks.ts): with no geofence_m the radius is 300 m and
  // proof up to 1 km away goes to review instead of failing; a radius the customer set is strict. Remote jobs
  // (no location) have no fence at all.
  const geofence = req?.geofence_m ?? 300;
  const reviewRadius = req?.geofence_m == null ? 1000 : geofence;
  const onSite = job?.location.lat != null && job?.location.lng != null;
  const minPhotos = req?.photos?.min ?? (req?.video || req?.files ? 0 : 1);
  const mustShow = req?.photos?.must_show ?? [];

  const photos = items.filter((i) => i.role === "photo");
  const videos = items.filter((i) => i.role === "video");
  const files = items.filter((i) => i.role === "file");
  const certs = items.filter((i) => i.role === "certification");

  const dist = fix && job && onSite ? distanceM(fix.lat, fix.lng, job.location.lat, job.location.lng) : null;
  const outside = dist !== null && dist > geofence;
  const tooFar = dist !== null && dist > reviewRadius;
  const stale = items.some((i) => Date.now() - i.file.lastModified > STALE_MS);
  const shortVideo = req?.video && videos.length > 0 && videos.every((v) => (v.durationS ?? Infinity) < req.video!.min_seconds);

  const missing = useMemo(() => {
    const m: string[] = [];
    if (photos.length < minPhotos) m.push(`${minPhotos - photos.length} more photo${minPhotos - photos.length === 1 ? "" : "s"}`);
    const unticked = mustShow.filter((s) => !checked[s]);
    if (unticked.length) m.push(`tick ${unticked.length} checklist item${unticked.length === 1 ? "" : "s"}`);
    if (req?.video && videos.length === 0) m.push("a video");
    if (req?.files && files.length === 0) m.push("the requested file");
    if (job?.certification_required && certs.length === 0) m.push("your certification");
    for (const f of req?.fields ?? []) if (!fields[f.name]?.trim()) m.push(f.name.replace(/_/g, " "));
    if (items.length === 0 && m.length === 0) m.push("at least one photo or file");
    if (!fix) m.push("your location");
    return m;
  }, [photos.length, minPhotos, mustShow, checked, req, videos.length, files.length, certs.length, job, fields, items.length, fix]);

  function add(role: Role, list: FileList | null) {
    if (!list?.length) return;
    const next: Item[] = Array.from(list).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      role,
      file, // the original File: never re-encoded, so EXIF survives
      preview: file.type.startsWith("image/") || file.type.startsWith("video/") ? URL.createObjectURL(file) : null,
      url: null,
      progress: 0,
      status: "ready",
    }));
    setItems((prev) => [...prev, ...next]);
    for (const it of next) if (it.file.type.startsWith("video/") && it.preview) readDuration(it);
  }

  function readDuration(it: Item) {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, durationS: v.duration } : p)));
    v.src = it.preview!;
  }

  function remove(id: string) {
    setItems((prev) => {
      const it = prev.find((p) => p.id === id);
      if (it?.preview) URL.revokeObjectURL(it.preview);
      return prev.filter((p) => p.id !== id);
    });
  }

  const patch = (id: string, p: Partial<Item>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));

  async function uploadOne(it: Item): Promise<string> {
    if (it.url) return it.url;
    patch(it.id, { status: "uploading", progress: 0 });
    for (let attempt = 0; ; attempt++) {
      try {
        let url: string;
        if (blobEnabled) {
          const ext = it.file.name.includes(".") ? it.file.name.split(".").pop() : it.file.type.split("/")[1] ?? "bin";
          const res = await upload(`proofs/${it.role}-${Date.now()}.${ext}`, it.file, {
            access: "public",
            handleUploadUrl: `/j/${encodeURIComponent(token)}/upload`,
            contentType: it.file.type || "application/octet-stream",
            multipart: it.file.size > 8 * 1024 * 1024,
            onUploadProgress: ({ percentage }) => patch(it.id, { progress: percentage }),
          });
          url = res.url;
        } else {
          url = await readAsDataUrl(it.file); // original bytes, base64; still no re-encoding
        }
        patch(it.id, { status: "done", progress: 100, url });
        it.url = url;
        return url;
      } catch (e) {
        if (attempt >= 2) {
          patch(it.id, { status: "error" });
          throw e;
        }
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }

  async function onSubmit() {
    setError(null);
    if (tooFar && !window.confirm(`You're about ${meters(dist!)} from the job. Proof sent from here will likely be rejected, and that ends the job. Send it anyway?`)) return;
    if (!blobEnabled) {
      const total = items.reduce((n, i) => n + i.file.size, 0);
      if (total > INLINE_LIMIT) {
        setError(
          `Large uploads aren't switched on yet, and these files total ${(total / 1048576).toFixed(1)} MB (limit ${INLINE_LIMIT / 1048576} MB). Remove a photo or two and try again.`,
        );
        return;
      }
    }

    // GPS at upload time, not from when the page opened.
    setPhase("locating");
    const f = await locate();
    if (!f) {
      setPhase("edit");
      return;
    }

    setPhase("uploading");
    let media: ProofBody["media"];
    try {
      media = [];
      for (const it of items) media.push({ url: await uploadOne(it), kind: it.file.type || "application/octet-stream", name: it.file.name, role: it.role });
    } catch {
      setPhase("error");
      setError("Some files didn't upload. Your photos are still here; check your signal and tap Retry.");
      return;
    }

    setPhase("submitting");
    const earliest = Math.min(...items.map((i) => i.file.lastModified || Date.now()));
    const capturedAt = new Date(Number.isFinite(earliest) && earliest > 0 ? earliest : Date.now()).toISOString();
    const r = await submitProof(token, {
      media,
      gps_lat: f.lat,
      gps_lng: f.lng,
      captured_at: capturedAt,
      fields: {
        ...Object.fromEntries((req?.fields ?? []).map((d) => [d.name, d.type === "number" ? Number(fields[d.name]) : fields[d.name]])),
        must_show_checked: mustShow.filter((s) => checked[s]),
        gps_accuracy_m: Math.round(f.accuracy),
        gps_fixed_at: new Date(f.at).toISOString(),
        submitted_at: new Date().toISOString(),
      },
    });

    if (r.ok) return setDone(true);
    if (r.status === 409) {
      // A retried submit may have landed already.
      const again = await refresh();
      if (again.ok && again.data.state !== "accepted" && again.data.state !== "open") return setDone(true);
      setPhase("error");
      setError("This job isn't open for proof anymore. Go back to the job page to see its status.");
      return;
    }
    if (r.status === 404) return setLoad("expired");
    setPhase("error");
    setError(
      r.error === "no_media"
        ? "No photos or files were attached. Add your proof and try again."
        : "We couldn't send your proof. Your photos are saved on this page; check your signal and tap Retry.",
    );
  }

  if (load === "loading") return <Loading />;
  if (load === "expired") return <Expired />;
  if (load === "offline") return <Offline retry={() => { setLoad("loading"); refresh(); }} />;

  const jobPath = `/j/${encodeURIComponent(token)}`;

  if (done)
    return (
      <Message icon="check" title="Proof sent" bar={<Link className="btn secondary" href={jobPath}>Back to the job</Link>}>
        <p className="muted">We&apos;re checking it now. You&apos;ll get paid as soon as it&apos;s approved, usually within minutes.</p>
      </Message>
    );

  if (!load.can_upload_proof)
    return (
      <Message icon="lock" title="Proof isn't open for this job" bar={<Link className="btn secondary" href={jobPath}>See job status</Link>}>
        <p className="muted">
          {load.state === "proof_submitted" || load.state === "approved" || load.state === "paid"
            ? "You've already sent proof for this job."
            : "Only the person who accepted this job can upload proof, while the job is active."}
        </p>
      </Message>
    );

  const busy = phase === "locating" || phase === "uploading" || phase === "submitting";
  const uploadedCount = items.filter((i) => i.status === "done").length;
  const blocked = missing.length > 0 || geoErr === "denied" || blobEnabled === null;

  const bar = (
    <>
      {!busy && missing.length > 0 && <div className="small muted center">Still needed: {missing.join(" · ")}</div>}
      <button className="btn" onClick={onSubmit} disabled={busy || blocked}>
        {phase === "locating" ? (
          <><span className="spinner" /> Checking your location…</>
        ) : phase === "uploading" ? (
          <><span className="spinner" /> Uploading {uploadedCount}/{items.length}…</>
        ) : phase === "submitting" ? (
          <><span className="spinner" /> Sending proof…</>
        ) : phase === "error" ? (
          "Retry"
        ) : (
          "Submit proof"
        )}
      </button>
    </>
  );

  return (
    <Shell bar={bar}>
      <Link href={jobPath} className="small row" style={{ gap: 4 }}><Icon name="arrowLeft" size={16} /> {job!.title}</Link>
      <h1>Upload proof</h1>

      {/* 1. Location */}
      <section className="card stack">
        <div className="row between">
          <h2 className="row"><Icon name="pin" /> Your location</h2>
          {onSite && fix && !outside && <span className="pill good">On site</span>}
          {outside && <span className="pill warn">{tooFar ? "Too far" : "Needs review"}</span>}
        </div>
        {geoErr ? (
          <>
            <div className="notice bad" role="alert">{GEO_HELP[geoErr]}</div>
            <button className="btn outline" onClick={locate}>Try location again</button>
          </>
        ) : !fix ? (
          <>
            <p className="row muted"><span className="spinner" /> Finding you… allow location if your phone asks.</p>
            <p className="small muted">We use it once, when you submit, to confirm you were at the job.</p>
            <button className="btn outline" onClick={locate}>Share my location</button>
          </>
        ) : outside ? (
          <>
            <div className="notice warn">
              You&apos;re about <strong>{meters(dist!)}</strong> from the job. Proof should be uploaded within {geofence} m of{" "}
              <a href={mapsUrl(job!.location.lat, job!.location.lng)} target="_blank" rel="noreferrer noopener">{job!.location.address}</a>.{" "}
              {tooFar
                ? "From here it would be rejected, so go to the job and check again."
                : "From here it goes to review before you're paid, so payment can take longer."}
            </div>
            <button className="btn outline" onClick={locate}>I&apos;ve moved, check again</button>
          </>
        ) : !onSite ? (
          <p className="muted small">Remote job: there is no job location to check against.</p>
        ) : (
          <p className="muted small">
            {meters(dist!)} from the job (±{meters(fix.accuracy)}). We&apos;ll check again when you submit.
          </p>
        )}
      </section>

      {/* 2. Photos + checklist */}
      {(minPhotos > 0 || mustShow.length > 0 || (!req?.video && !req?.files)) && (
        <section className="card stack">
          <div className="row between">
            <h2 className="row"><Icon name="camera" /> Photos</h2>
            <span className={`pill ${photos.length >= minPhotos ? "good" : ""}`}>
              {photos.length}/{Math.max(minPhotos, 1)}{minPhotos ? " min" : ""}
            </span>
          </div>
          {mustShow.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <p className="small muted">Make sure your photos clearly show each of these. Tick them off as you shoot.</p>
              {mustShow.map((s) => (
                <label key={s} className={`check ${checked[s] ? "done" : ""}`}>
                  <input type="checkbox" checked={!!checked[s]} onChange={(e) => setChecked((c) => ({ ...c, [s]: e.target.checked }))} />
                  <span>{s}</span>
                </label>
              ))}
            </div>
          )}
          <Thumbs items={photos} onRemove={remove} disabled={busy} />
          <Picker icon="camera" label={photos.length ? "Take another photo" : "Take photos"} accept="image/*" capture onPick={(f) => add("photo", f)} disabled={busy} primary />
          <Picker label="Choose from library" accept="image/*" onPick={(f) => add("photo", f)} disabled={busy} />
        </section>
      )}

      {/* 3. Video */}
      {req?.video && (
        <section className="card stack">
          <div className="row between">
            <h2 className="row"><Icon name="video" /> Video</h2>
            <span className="pill">{req.video.min_seconds}s+</span>
          </div>
          <Thumbs items={videos} onRemove={remove} disabled={busy} />
          {shortVideo && <div className="notice warn">This video is shorter than {req.video.min_seconds} seconds. Record a longer one.</div>}
          <Picker icon="video" label={videos.length ? "Record another" : "Record video"} accept="video/*" capture onPick={(f) => add("video", f)} disabled={busy} primary />
        </section>
      )}

      {/* 4. Files */}
      {req?.files && (
        <section className="card stack">
          <h2 className="row"><Icon name="file" /> Files</h2>
          <p className="small muted">Needed: {req.files.kinds.join(", ")}</p>
          <Thumbs items={files} onRemove={remove} disabled={busy} />
          <Picker label="Add a file" accept="image/*,application/pdf" onPick={(f) => add("file", f)} disabled={busy} primary={files.length === 0} />
        </section>
      )}

      {/* 5. Certification */}
      {job!.certification_required && (
        <section className="card stack">
          <h2 className="row"><Icon name="badge" /> Certification</h2>
          <p className="small muted">This job requires <strong>{job!.certification_required}</strong>. Add a photo or PDF of it.</p>
          <Thumbs items={certs} onRemove={remove} disabled={busy} />
          <Picker label="Add certification" accept="image/*,application/pdf" onPick={(f) => add("certification", f)} disabled={busy} primary={certs.length === 0} />
        </section>
      )}

      {/* 6. Fields */}
      {req?.fields && req.fields.length > 0 && (
        <section className="card stack">
          <h2 className="row"><Icon name="pencil" /> Details</h2>
          {req.fields.map((f) => (
            <div key={f.name} className="field">
              <label htmlFor={`f-${f.name}`}>{f.name.replace(/_/g, " ")}</label>
              <input
                id={`f-${f.name}`}
                inputMode={f.type === "number" ? "decimal" : "text"}
                type={f.type === "number" ? "number" : "text"}
                value={fields[f.name] ?? ""}
                onChange={(e) => setFields((v) => ({ ...v, [f.name]: e.target.value }))}
                disabled={busy}
              />
            </div>
          ))}
        </section>
      )}

      {stale && (
        <div className="notice warn">
          Some photos are more than 6 hours old. Proof should be taken now, on site; old photos get flagged for review.
        </div>
      )}
      {error && <div className="notice bad" role="alert">{error}</div>}
    </Shell>
  );
}

function Picker({
  icon,
  label,
  accept,
  capture,
  onPick,
  disabled,
  primary,
}: {
  icon?: "camera" | "video";
  label: string;
  accept: string;
  capture?: boolean;
  onPick: (f: FileList | null) => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={`btn ${primary ? "secondary" : "ghost"}`} onClick={() => ref.current?.click()} disabled={disabled}>
        {icon && <Icon name={icon} />}
        {label}
      </button>
      <input
        ref={ref}
        className="hidden-input"
        type="file"
        accept={accept}
        multiple
        {...(capture ? { capture: "environment" as const } : {})}
        onChange={(e) => {
          onPick(e.target.files);
          e.target.value = ""; // allow picking the same file again
        }}
        tabIndex={-1}
        aria-hidden
      />
    </>
  );
}

function Thumbs({ items, onRemove, disabled }: { items: Item[]; onRemove: (id: string) => void; disabled: boolean }) {
  if (!items.length) return null;
  return (
    <div className="thumbs">
      {items.map((i) => (
        <div key={i.id} className="thumb">
          {i.preview && i.file.type.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={i.preview} alt="" />
          ) : i.preview && i.file.type.startsWith("video/") ? (
            <video src={i.preview} muted playsInline />
          ) : (
            <div className="file"><Icon name="file" /> {i.file.name}</div>
          )}
          {!disabled && i.status !== "done" && (
            <button type="button" onClick={() => onRemove(i.id)} aria-label={`Remove ${i.file.name}`}><Icon name="x" size={14} stroke={2.6} /></button>
          )}
          {i.status === "uploading" && <div className="bar" style={{ width: `${i.progress}%` }} />}
          {i.status === "done" && <span className="state">✓</span>}
          {i.status === "error" && <span className="state">!</span>}
        </div>
      ))}
    </div>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
