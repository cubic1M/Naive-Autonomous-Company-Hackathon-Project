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
import { listManualQueue, markManualSent } from './manualQueue.js';
import type { Monid } from './monid.js';
import type { Repo } from './repo.js';
import type { SearchHints } from './types.js';
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

export const hintsShape = z
  .object({
    roles: z.array(z.string().min(1)).max(8).optional().describe('Job titles to search for, e.g. ["contract attorney","paralegal"], ["React developer"], ["brand ambassador"].'),
    skills: z.array(z.string().min(1)).max(12).optional().describe('Skills/keywords, e.g. ["SaaS","terms of service"] or ["TypeScript","Next.js"].'),
    credential: z.string().nullable().optional().describe('Required credential, e.g. "California bar license", "notary public". Candidates without it rank far lower.'),
    remote: z.boolean().optional().describe('true = online work, anyone in the world, no distance limit. false = on-site near the job.'),
  })
  .describe('Describe who you need. You understand the job better than our keyword table: always pass roles, skills, credential and remote.');

export const findPeopleShape = {
  job_id: z.string().min(1).describe('The job to staff.'),
  limit: z.number().int().min(1).max(50).optional().describe('Max candidates to return (default 20).'),
  hints: hintsShape.optional(),
};

export const manualQueueShape = {
  job_id: z.string().min(1).optional().describe('Only DMs for this job.'),
  status: z.enum(['queued', 'sent', 'skipped']).optional().describe('Default: queued.'),
};

export const markManualSentShape = {
  id: z.string().min(1).describe('Manual DM id from manual_queue.'),
  status: z.enum(['sent', 'skipped']).describe('sent = a teammate sent it from a real Operis account; skipped = decided not to.'),
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
        'Find INDIVIDUAL people for any job: on-site gigs (sign holding, photos, delivery, notary) near the job, or online work (legal, software, design, writing, translation...) from anywhere. Searches public profiles (LinkedIn, X, Reddit, portfolios, directories), our regulars, and Google Maps businesses as a backup for on-site jobs. Pass hints (roles, skills, credential, remote) describing who you need. Returns ranked candidates: candidate_id, name, channel (email = sent automatically; linkedin_manual/x_manual/reddit_manual/instagram_manual = a DM is drafted and queued for a teammate), source, distance_km (null for remote jobs), score. Costs a few cents; capped server-side.',
      inputSchema: findPeopleShape,
      handler: async (args: { job_id: string; limit?: number; hints?: SearchHints }): Promise<ToolResult> => {
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
        'Invite chosen candidates to a job with a signed accept link (email; SMS only for consenting regulars). Never messages opted-out people or anyone twice for the same job. Manual-channel candidates (LinkedIn/X/Reddit/Instagram) get a drafted DM queued for a teammate instead. Returns sent, skipped_opted_out, queued_manual, outreach_ids.',
      inputSchema: sendBlastShape,
      handler: async (args: { job_id: string; candidate_ids: string[] }): Promise<ToolResult> => {
        try {
          return ok(await sendBlast(args, deps));
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: 'manual_queue',
      description:
        'List DMs drafted for people we can only reach by LinkedIn/X/Reddit/Instagram DM. A teammate sends them by hand from a real Operis account. Returns id, platform, profile_url, message, status. Never claim these were sent until mark_manual_sent says so.',
      inputSchema: manualQueueShape,
      handler: async (args: { job_id?: string; status?: 'queued' | 'sent' | 'skipped' }): Promise<ToolResult> => {
        try {
          const rows = await listManualQueue(deps.repo, { ...(args.job_id ? { job_id: args.job_id } : {}), status: args.status ?? 'queued' });
          return ok({ queue: rows.map((r) => ({ id: r.id, job_id: r.job_id, platform: r.platform, profile_url: r.profile_url, message: r.message, status: r.status })) });
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: 'mark_manual_sent',
      description: 'Record that a teammate sent (or skipped) a queued DM. Returns { ok: true }.',
      inputSchema: markManualSentShape,
      handler: async (args: { id: string; status: 'sent' | 'skipped' }): Promise<ToolResult> => {
        try {
          await markManualSent(deps.repo, args.id, args.status);
          return ok({ ok: true });
        } catch (e) {
          return fail(e);
        }
      },
    },
  ] as const;
}
