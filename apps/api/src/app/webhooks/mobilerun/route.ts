// Mobilerun platform webhooks: sms.received (worker replies), sms.send.failed.
// Worker replies: "YES 4821" accepts, "NO 4821" declines, "STOP" opts out forever.
import { verifyMobilerunSignature } from "@/lib/mobilerun";
import { sql } from "@/lib/db";
import { acceptJob, declineJob, openOutreachForPhone } from "@/lib/worker";
import { outreachConfigured, classifyInbound } from "@/tools/outreach";
import { sendSms } from "@/lib/messaging";
import { later } from "@/lib/naive";
export const dynamic = "force-dynamic";

const normPhone = (p: string) => { const d = p.replace(/[^\d+]/g, ""); return d.startsWith("+") ? d : d.length === 10 ? `+1${d}` : `+${d}`; };

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyMobilerunSignature(raw, req.headers.get("x-mobilerun-timestamp"), req.headers.get("x-mobilerun-signature")))
    return new Response("bad signature", { status: 401 });
  const evt = JSON.parse(raw);
  // dedupe on Mobilerun's stable event id
  const fresh = await sql`insert into webhook_events (provider, event_id, type) values ('mobilerun', ${evt.id}, ${evt.type})
                          on conflict do nothing returning event_id`;
  if (!fresh.length) return Response.json({ ok: true, duplicate: true });
  console.log("[mobilerun]", evt.type, JSON.stringify(evt.data).slice(0, 500));

  if (evt.type === "sms.received") later(() => handleInbound(evt));
  if (evt.type === "sms.send.failed")
    await sql`update messaging_events set status = 'failed:carrier' where provider = 'mobilerun' and provider_id = ${evt.data?.id ?? evt.data?.messageId ?? ""}`;
  return Response.json({ ok: true });
}

async function handleInbound(evt: any) {
  const d = evt.data ?? {};
  // payload shape isn't documented yet: read the likely field names (raw event is logged above)
  const from = normPhone(String(d.from ?? d.fromNumber ?? d.sender ?? d.message?.from ?? ""));
  const body = String(d.body ?? d.text ?? d.message?.body ?? d.content ?? "").trim();
  await sql`insert into messaging_events (direction, provider, provider_id, phone, body, status) values ('in', 'mobilerun', ${evt.id}, ${from}, ${body}, 'received')`;

  // Andrew's classifier handles STOP / regulars / questions; we handle accept + decline (job state is ours).
  if (outreachConfigured()) {
    const r: any = await classifyInbound(from, body);
    if (r.action === "accept_requested") return accept(from, r.code);
    if (r.action === "declined") { const o = await openOutreachForPhone(from); if (o) await declineJob(o.id); return; }
    if (r.reply_text) await sendSms(from, r.reply_text);
    return;
  }
  const m = body.toUpperCase().match(/^(YES|Y|NO|N|STOP|UNSUBSCRIBE)\b\s*(\d{4})?/);
  if (!m) return;
  const [, word, code] = m;
  if (word === "STOP" || word === "UNSUBSCRIBE") { await sql`update workers set opted_out = true where phone = ${from}`; return; }
  if (word.startsWith("Y")) return accept(from, code);
  const o = await openOutreachForPhone(from, code); if (o) await declineJob(o.id);
}

async function accept(from: string, code?: string) {
  const o = await openOutreachForPhone(from, code);
  if (!o) { await sendSms(from, code ? `We couldn't find an open job with code ${code}.` : "You have more than one open offer. Reply YES plus the 4-digit code from the message, e.g. YES 1234."); return; }
  const r = await acceptJob(o.id);
  await sendSms(from, r.ok ? "You got it! Open your job link for details and to upload proof when done." : "Sorry, someone else already took this job.");
}
