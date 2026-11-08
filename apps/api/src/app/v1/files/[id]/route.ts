import { sql } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("not found", { status: 404 });
  const [f] = await sql`select mime, bytes from proof_files where id = ${id}`;
  if (!f) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(f.bytes), { headers: { "Content-Type": f.mime, "Cache-Control": "public, max-age=31536000, immutable" } });
}
