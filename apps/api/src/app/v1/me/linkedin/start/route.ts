// LinkedIn sign-in isn't set up yet: go back with a flag the page can show; the portfolio link still works.
import { baseUrl } from "@/lib/env";
import { safeNext } from "@/lib/accounts";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const back = safeNext(new URL(req.url).searchParams.get("return"));
  return Response.redirect(`${baseUrl()}${back}${back.includes("?") ? "&" : "?"}linkedin=unavailable`, 302);
}
