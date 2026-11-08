// Issues Vercel Blob client-upload tokens so the phone uploads original files straight to Blob
// (bytes stored as-is, EXIF intact, no 4.5 MB function body limit). Only the worker assigned to an
// active job can get one: we check the link token against the API before signing.
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export const dynamic = "force-dynamic";

const API_URL = (process.env.API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const MAX_BYTES = 200 * 1024 * 1024; // videos can be big

/** The proof page asks first, so it can fall back to inline uploads when Blob isn't set up. */
export function GET() {
  return Response.json({ enabled: Boolean(process.env.BLOB_READ_WRITE_TOKEN) });
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return Response.json({ error: "blob_not_configured" }, { status: 501 });
  const { token } = await params;
  const body = (await req.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const r = await fetch(`${API_URL}/v1/worker/jobs/${encodeURIComponent(token)}`, { cache: "no-store" });
        const job = r.ok ? await r.json() : null;
        if (!job?.can_upload_proof) throw new Error("not_your_active_job");
        if (!pathname.startsWith("proofs/")) throw new Error("bad_path");
        return {
          allowedContentTypes: ["image/*", "video/*", "application/pdf", "application/octet-stream"],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
        };
      },
    });
    return Response.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upload_failed";
    return Response.json({ error: msg }, { status: msg === "not_your_active_job" ? 409 : 400 });
  }
}
