// POST /v1/auth/logout: end this browser's session.
import { endSession } from "@/lib/workerAccounts";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const c = await endSession(req);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": c } });
}
