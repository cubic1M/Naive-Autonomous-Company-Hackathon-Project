import { sql, addLedger } from "./db";
import { flag, optional } from "./env";
import { mobilerunSend } from "./mobilerun";
import { monid } from "./monid";

/**
 * Send one SMS. Order: Mobilerun → Monid AgentLine. Logs every attempt to messaging_events
 * and books the cost. Set SMS_PROVIDER=monid to skip Mobilerun, PAUSE_OUTREACH=true to stop all sends.
 */
export async function sendSms(to: string, body: string, meta: { jobId?: string; workerId?: string } = {}) {
  if (flag("PAUSE_OUTREACH")) return { ok: false, provider: "none", error: "paused" };
  const optedOut = await sql`select 1 from workers where phone = ${to} and opted_out = true limit 1`;
  if (optedOut.length) return { ok: false, provider: "none", error: "opted_out" };

  const tryMobilerun = (optional("SMS_PROVIDER") ?? "mobilerun") !== "monid";
  let result: { ok: boolean; provider: string; id?: string; error?: string } = { ok: false, provider: "none", error: "no_provider" };

  if (tryMobilerun) {
    const r = await mobilerunSend(to, body, meta.jobId ? `${meta.jobId}:${to}:${body.length}` : undefined);
    result = r.ok ? { ok: true, provider: "mobilerun", id: r.id } : { ok: false, provider: "mobilerun", error: r.error };
  }
  if (!result.ok && optional("MONID_AGENTLINE_NUMBER_ID")) {
    try {
      const r = await monid.run("agentline", "/send-messages", { number_id: optional("MONID_AGENTLINE_NUMBER_ID"), to, body });
      result = { ok: true, provider: "monid_agentline", id: r?.runId ?? r?.id };
      await addLedger(meta.jobId ?? null, "sms_cost", 0.02, result.id);
    } catch (e) {
      result = { ok: false, provider: "monid_agentline", error: String(e).slice(0, 200) };
    }
  }
  await sql`
    insert into messaging_events (direction, provider, provider_id, phone, body, job_id, worker_id, status)
    values ('out', ${result.provider}, ${result.id ?? null}, ${to}, ${body}, ${meta.jobId ?? null}, ${meta.workerId ?? null},
            ${result.ok ? "sent" : "failed:" + (result.error ?? "")})`;
  return result;
}
