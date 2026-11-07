// SHARED CONTRACT: how a tool implementation is called.
// Andrew and Cameron: export functions of type ToolImpl<"tool_name"> from services/<area>/index.ts.
// The API passes a ToolContext, so services never import apps/api internals.

import type { Tools } from "./tools";
import type { JobState } from "./states";

export interface ToolContext {
  /** postgres.js tagged template, connected to our database */
  sql: any;
  /** Move a job to a new state (validated against contracts/states.ts) and wake the next agent. */
  transition(jobId: string, to: JobState, patch?: Record<string, unknown>): Promise<Record<string, any>>;
  /** Send an SMS through our shared messaging layer (Mobilerun, falling back to Monid AgentLine). */
  sendSms(to: string, body: string, meta?: { jobId?: string; workerId?: string }): Promise<{ ok: boolean; provider: string; id?: string; error?: string }>;
  /** Call a Monid endpoint (discover/inspect/run). */
  monid: {
    discover(query: string): Promise<any>;
    inspect(provider: string, endpoint: string): Promise<any>;
    run(provider: string, endpoint: string, input: unknown): Promise<any>;
  };
  /** Append to the ledger. */
  ledger(jobId: string | null, kind: string, amountUsd: number, ref?: string): Promise<void>;
  /** Public base URL of the API (for building worker links). */
  baseUrl: string;
  log(...args: unknown[]): void;
}

export type ToolName = keyof Tools;
export type ToolImpl<K extends ToolName> = (input: Tools[K]["in"], ctx: ToolContext) => Promise<Tools[K]["out"]>;
export type ServiceModule = { [K in ToolName]?: ToolImpl<K> | null };
