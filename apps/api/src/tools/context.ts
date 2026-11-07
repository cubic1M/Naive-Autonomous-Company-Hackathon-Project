import type { ToolContext } from "@contracts/runtime";
import { sql, addLedger } from "@/lib/db";
import { transition } from "@/lib/jobs";
import { sendSms } from "@/lib/messaging";
import { monid } from "@/lib/monid";
import { baseUrl } from "@/lib/env";

export function makeContext(): ToolContext {
  return {
    sql,
    transition,
    sendSms,
    monid,
    ledger: addLedger,
    baseUrl: baseUrl(),
    log: (...a) => console.log("[tool]", ...a),
  };
}
