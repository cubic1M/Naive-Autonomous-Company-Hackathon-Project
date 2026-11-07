/**
 * MCP tool definitions for the internal Operis MCP server (apps/api/src/mcp/internal.ts, Edwin).
 * Agents see them as `operis.find_people` / `operis.send_blast` (server name "operis").
 *
 * Register with @modelcontextprotocol/sdk:
 *   for (const t of outreachTools(deps)) server.registerTool(t.name, { description: t.description, inputSchema: t.inputSchema }, t.handler);
 */
import { z } from 'zod';
import { sendBlast } from './blast.js';
import type { Env } from './env.js';
import { findPeople } from './find.js';
import type { Monid } from './monid.js';
import type { Repo } from './repo.js';
import type { EmailSender, SmsSender } from './senders.js';

export interface OutreachDeps {
  repo: Repo;
  monid: Monid;
  env: Env;
  email: EmailSender;
  sms?: SmsSender;
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function fail(e: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true };
}

export const findPeopleShape = {
  job_id: z.string().min(1).describe('The job to staff.'),
  limit: z.number().int().min(1).max(50).optional().describe('Max candidates to return (default 20).'),
};

export const sendBlastShape = {
  job_id: z.string().min(1).describe('The job to invite people to.'),
  candidate_ids: z.array(z.string().min(1)).min(1).max(50).describe('candidate_id values from find_people.'),
};

export function outreachTools(deps: OutreachDeps) {
  return [
    {
      name: 'find_people',
      description:
        'Find people or small businesses near a job who could do it, from public listings (Google Maps, business websites) and our regulars. Returns ranked candidates: candidate_id, name, channel, source, distance_km, score. Costs a few cents; capped server-side.',
      inputSchema: findPeopleShape,
      handler: async (args: { job_id: string; limit?: number }): Promise<ToolResult> => {
        try {
          return ok(await findPeople(args, deps));
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: 'send_blast',
      description:
        'Invite chosen candidates to a job with a signed accept link (email; SMS only for consenting regulars). Never messages opted-out people or anyone twice for the same job. Returns sent, skipped_opted_out, outreach_ids.',
      inputSchema: sendBlastShape,
      handler: async (args: { job_id: string; candidate_ids: string[] }): Promise<ToolResult> => {
        try {
          return ok(await sendBlast(args, deps));
        } catch (e) {
          return fail(e);
        }
      },
    },
  ] as const;
}
