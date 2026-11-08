// The join link in Recruiter invites (services/growth). GET shows the page and changes nothing, so email link
// scanners can't opt anyone in; POST action=opt_in makes the person a regular, action=identity starts Stripe Identity.
import { sql } from "@/lib/db";
import { growthJoinAction, growthJoinPage, pageResponse } from "@services/growth/index";
export const dynamic = "force-dynamic";

const failed = (e: unknown) => {
  console.error("[growth:join]", e);
  return new Response("Something went wrong. Please try again later, or email ops@operis.live.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
};

export async function GET(req: Request) {
  try {
    return pageResponse(await growthJoinPage(sql, new URL(req.url).searchParams.get("t")));
  } catch (e) {
    return failed(e);
  }
}

export async function POST(req: Request) {
  try {
    const form = await req.formData().catch(() => null);
    const field = (k: string) => {
      const v = form?.get(k);
      return typeof v === "string" ? v : null;
    };
    return pageResponse(await growthJoinAction(sql, field("t"), field("action") ?? ""));
  } catch (e) {
    return failed(e);
  }
}
