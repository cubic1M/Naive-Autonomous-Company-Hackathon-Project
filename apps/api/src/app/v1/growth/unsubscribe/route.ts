// One-click unsubscribe for Sales and Recruiter email (services/growth). GET from the email's link; POST for mail
// clients' one-click unsubscribe (RFC 8058). Opts the address out of every Operis email, Ops' job offers included.
import { sql } from "@/lib/db";
import { growthUnsubscribe, pageResponse } from "@services/growth/index";
export const dynamic = "force-dynamic";

async function handle(req: Request) {
  try {
    return pageResponse(await growthUnsubscribe(sql, new URL(req.url).searchParams.get("t")));
  } catch (e) {
    console.error("[growth:unsubscribe]", e);
    return new Response("Something went wrong. Email ops@operis.live and we will remove you by hand.", { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
export { handle as GET, handle as POST };
