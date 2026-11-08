// Log of every call customer agents make to us, for the founders' live view (backoffice "Calls from agents").
// Written after the response (later()), never awaited by the caller, and never allowed to fail a request.
import { sql } from "@/lib/db";
import { later } from "@/lib/naive";

export type CallLog = {
  customer?: { id: string; name: string } | null;
  channel: "mcp" | "signup" | "oauth";
  method?: string | null;
  tool?: string | null;
  outcome: "ok" | "rejected" | "error" | "unauthorized" | "crawler";
  http_status?: number | null;
  duration_ms?: number | null;
  job_id?: string | null;
  summary?: string | null;
  client?: string | null;
  ip?: string | null;
};

const clip = (s: unknown, n = 300) => (s == null ? null : String(s).replace(/\s+/g, " ").slice(0, n));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function logCall(c: CallLog) {
  later(async () => {
    try {
      await sql`insert into api_calls (customer_id, customer_name, channel, method, tool, outcome, http_status, duration_ms, job_id, summary, client, ip)
                values (${c.customer?.id ?? null}, ${clip(c.customer?.name, 120)}, ${c.channel}, ${clip(c.method, 60)}, ${clip(c.tool, 60)},
                        ${c.outcome}, ${c.http_status ?? null}, ${c.duration_ms ?? null}, ${c.job_id && UUID.test(c.job_id) ? c.job_id : null},
                        ${clip(c.summary)}, ${clip(c.client, 120)}, ${clip(c.ip, 60)})`;
    } catch (e) {
      // Before migration 012 the table doesn't exist: skip quietly rather than break the call.
      console.warn("[api_calls] not logged:", String(e).slice(0, 160));
    }
  });
}

export const requestIp = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null;
export const userAgent = (req: Request) => req.headers.get("user-agent");

/** One line a founder can read: what this tool call did. */
export function summarize(tool: string, args: any, out: any): { summary: string; job_id: string | null; outcome: "ok" | "rejected" } {
  const money = (n: unknown) => (n == null ? "" : ` · $${n}`);
  if (tool === "request_human") {
    const where = args?.remote ? "remote" : args?.location?.address ?? "";
    const base = `"${args?.title ?? "untitled"}"${money(args?.budget_usd)}${where ? ` · ${where}` : ""}`;
    if (out?.status === "rejected") return { summary: `${base} → rejected: ${out?.reason ?? ""}`, job_id: out?.job_id ?? null, outcome: "rejected" };
    return { summary: `${base} → ${out?.status ?? "?"}${out?.escrow_url ? " (payment link sent)" : ""}`, job_id: out?.job_id ?? null, outcome: "ok" };
  }
  if (tool === "get_job") return { summary: `checked job → ${out?.status ?? "?"}`, job_id: args?.job_id ?? null, outcome: "ok" };
  if (tool === "cancel_job") return { summary: `cancelled job → ${out?.status ?? "?"}`, job_id: args?.job_id ?? null, outcome: "ok" };
  if (tool === "setup_payment") return { summary: out?.url ? "asked for a card-saving link" : "card already saved", job_id: null, outcome: "ok" };
  return { summary: tool, job_id: args?.job_id ?? null, outcome: "ok" };
}
