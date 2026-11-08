// Every other /v1/auth/* method (email + password, texted codes, email links) isn't live yet:
// answer with a clear code so the site can say "use Continue with Google".
export const dynamic = "force-dynamic";
const notYet = () => Response.json({ ok: false, error: "use_google" }, { status: 501 });
export const GET = notYet;
export const POST = notYet;
