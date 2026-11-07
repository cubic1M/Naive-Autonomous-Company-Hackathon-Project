// POST proof from Dora's upload page. Accepts either:
//  - multipart/form-data: files[] + gps_lat, gps_lng, captured_at, fields (JSON string)
//  - application/json: { media: [{url, kind}], gps_lat, gps_lng, captured_at, fields }
// Files go to Vercel Blob when BLOB_READ_WRITE_TOKEN is set (keeps EXIF: bytes stored as-is).
import { outreachByToken } from "@/lib/worker";
import { sql } from "@/lib/db";
import { transition } from "@/lib/jobs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const o = await outreachByToken(token);
  if (!o) return Response.json({ error: "not_found" }, { status: 404 });
  if (o.assigned_worker_id !== o.worker_id || o.job_status !== "accepted")
    return Response.json({ error: "not_your_active_job" }, { status: 409 });

  let media: { url: string; kind: string; name?: string }[] = [];
  let gpsLat: number | null = null, gpsLng: number | null = null, capturedAt: string | null = null, fields: any = {};
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    gpsLat = form.get("gps_lat") ? Number(form.get("gps_lat")) : null;
    gpsLng = form.get("gps_lng") ? Number(form.get("gps_lng")) : null;
    capturedAt = (form.get("captured_at") as string) || null;
    fields = form.get("fields") ? JSON.parse(String(form.get("fields"))) : {};
    const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
    if (!process.env.BLOB_READ_WRITE_TOKEN) return Response.json({ error: "file storage not configured (BLOB_READ_WRITE_TOKEN)" }, { status: 501 });
    const { put } = await import("@vercel/blob");
    for (const f of files) {
      const blob = await put(`proofs/${o.job_id}/${Date.now()}-${f.name}`, f, { access: "public", addRandomSuffix: true });
      media.push({ url: blob.url, kind: f.type || "application/octet-stream", name: f.name });
    }
  } else {
    const b = await req.json();
    media = b.media ?? [];
    gpsLat = b.gps_lat ?? null; gpsLng = b.gps_lng ?? null; capturedAt = b.captured_at ?? null; fields = b.fields ?? {};
  }
  if (media.length === 0) return Response.json({ error: "no_media" }, { status: 400 });

  const [p] = await sql`
    insert into proofs (job_id, worker_id, media, fields, gps_lat, gps_lng, captured_at)
    values (${o.job_id}, ${o.worker_id}, ${sql.json(media)}, ${sql.json(fields)}, ${gpsLat}, ${gpsLng}, ${capturedAt})
    returning id`;
  await transition(o.job_id, "proof_submitted");
  return Response.json({ ok: true, proof_id: p.id, state: "proof_submitted" });
}
