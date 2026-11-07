import { guideMarkdown } from "@/lib/guide";
import { apiBaseUrl } from "@/lib/env";
export const dynamic = "force-dynamic";
export function GET() {
  return new Response(guideMarkdown(apiBaseUrl()), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
