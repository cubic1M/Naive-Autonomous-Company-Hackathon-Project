import { sql } from "@/lib/db";
import { toolSources } from "@/tools/registry";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const [{ now }] = await sql`select now()`;
    return Response.json({ ok: true, db: "ok", now, tools: toolSources() });
  } catch (e: any) {
    return Response.json({ ok: false, db: e.message }, { status: 500 });
  }
}
