// apps/api/src/app/v1/worker/license/route.ts
// POST { token, kind: "notary" | "attorney", number, name }: the worker proves the licence a connector job needs
// (policy L1 notary commission, L2 State Bar). Cameron's services/compliance; docs/specs/2026-11-08-liability-model-design.md.
import { outreachByToken } from "@/lib/worker";
import * as compliance from "@services/compliance/index";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const o = typeof body?.token === "string" ? await outreachByToken(body.token) : undefined;
  if (!o) return Response.json({ error: "not_found" }, { status: 404 });
  if (!["notary", "attorney"].includes(body.kind) || typeof body.number !== "string" || typeof body.name !== "string") {
    return Response.json({ error: "bad_request", detail: "kind (notary or attorney), number and name are required" }, { status: 400 });
  }
  try {
    return Response.json(await compliance.verifyLicence({ workerId: o.worker_id, jobId: o.job_id, kind: body.kind, number: body.number, name: body.name }));
  } catch (e: any) {
    console.error("[license]", e);
    return Response.json({ error: "license_check_unavailable", message: String(e?.message ?? e).slice(0, 200) }, { status: 502 });
  }
}
