// Andrew's real outreach tools (services/outreach), adapted to our registry.
// Served as real when MONID_API_KEY and LINK_SIGNING_SECRET are set; otherwise the mocks run.
import {
  envFromProcess, HttpMonid, PostgresRepo, NaiveEmailSender, RecordingSender,
  findPeople, sendBlast, verifyJobToken, handleReply,
} from "../../../../services/outreach/src/index";
import type { ToolContext } from "@contracts/runtime";
import { sql } from "@/lib/db";
import { sendSms } from "@/lib/messaging";

export const outreachConfigured = () => Boolean(process.env.MONID_API_KEY && process.env.LINK_SIGNING_SECRET);

let cached: any;
function deps() {
  if (cached) return cached;
  const env = envFromProcess();
  const email =
    env.NAIVE_API_KEY && env.NAIVE_OPS_IDENTITY_ID && env.NAIVE_OPS_INBOX_ID
      ? new NaiveEmailSender({ apiKey: env.NAIVE_API_KEY, baseUrl: env.NAIVE_BASE_URL, identityId: env.NAIVE_OPS_IDENTITY_ID, inboxId: env.NAIVE_OPS_INBOX_ID })
      : new RecordingSender(); // no ops@ inbox yet: record instead of sending
  cached = {
    env,
    repo: new PostgresRepo(sql as any),
    monid: new HttpMonid(env.MONID_API_KEY, env.MONID_BASE_URL),
    email,
    sms: { send: async (to: string, body: string) => { const r = await sendSms(to, body); return r.ok ? { ok: true, ref: r.id } : { ok: false, error: r.error }; } },
  };
  return cached;
}

export async function realFindPeople(input: { job_id: string; limit?: number }, _ctx: ToolContext) {
  return findPeople(input, deps());
}

/** Andrew's send_blast doesn't change job state; we move held → outreach once someone was invited. */
export async function realSendBlast(input: { job_id: string; candidate_ids: string[] }, ctx: ToolContext) {
  const out: any = await sendBlast(input, deps());
  if ((out.sent ?? 0) + (out.dry_run ?? 0) > 0) {
    const [j] = await ctx.sql`select status from jobs where id = ${input.job_id}`;
    if (j?.status === "held") await ctx.transition(input.job_id, "outreach");
  }
  return out;
}

/** Signed-token check for worker links. Returns null if tampered or expired. Skipped if no secret. */
export function verifyLinkToken(token: string): { job_id: string; worker_id: string } | null | "unchecked" {
  const secret = process.env.LINK_SIGNING_SECRET;
  if (!secret || !token.includes(".")) return "unchecked";
  return verifyJobToken(token, secret);
}

export async function classifyInbound(from: string, text: string) {
  return handleReply({ channel: "sms", from, text } as any, { repo: deps().repo } as any);
}
