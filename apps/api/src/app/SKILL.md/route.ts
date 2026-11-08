import { skillMarkdown } from "@/lib/skill";
import { publicOrigin, CORS } from "@/lib/oauth";
export const dynamic = "force-dynamic";
export function GET(req: Request) {
  return new Response(skillMarkdown(publicOrigin(req)), { headers: { ...CORS, "Content-Type": "text/markdown; charset=utf-8" } });
}
