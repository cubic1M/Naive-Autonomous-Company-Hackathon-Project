import { clearCookie, endSession, json } from "@/lib/accounts";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await endSession(req);
  return json({ ok: true }, 200, clearCookie());
}
