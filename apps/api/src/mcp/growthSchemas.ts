// Zod input schemas for the growth tools (services/growth; contracts/tools.ts "GROWTH"). Kept apart from
// schemas.ts while PR #42 edits it; server.ts looks tools up in both.
import { z } from "zod";

const family = z
  .enum(["pier70_gigs", "sf_notaries", "ca_attorneys", "developers"])
  .describe("pier70_gigs: on-site gigs near Pier 70, SF; sf_notaries: mobile notaries in SF; ca_attorneys: remote California attorneys; developers: remote Next.js/React/TypeScript developers");

export const GROWTH_SCHEMAS = {
  list_prospects: {
    description: "Hand-sourced prospects (hackathon teams and other AI-agent builders) you may email: not emailed in 30 days, not opted out. Returns contact_id, name, org, email_domain, notes, found_via, free_first_job, plus used_today (sends + dry runs, what counts against the cap) and daily_cap.",
    shape: { limit: z.number().int().min(1).max(50).optional().describe("Max prospects (default 20).") },
  },
  send_marketing: {
    description: "Send Operis's fixed marketing email to one prospect from list_prospects. The code enforces opt-outs, the 30-day rule, the daily cap and live/allowlist/dry-run mode, and adds the unsubscribe link and postal address. With offer_free_first_job it may also record the free-first-job grant (eligible prospects only, and only when the email really goes out). Returns status sent | dry_run | skipped | failed with a reason.",
    shape: {
      contact_id: z.string().uuid().describe("contact_id from list_prospects."),
      personal_line: z.string().max(300).optional().describe("One sentence for this prospect about what they build; no links."),
      offer_free_first_job: z.boolean().optional().describe("Include the free-first-job offer; only works for prospects with free_first_job true."),
    },
  },
  suppress_contact: {
    description: "Opt an email address out of all Operis email forever (marketing, invites and Ops' job offers). Use whenever someone asks us to stop.",
    shape: { email: z.string().email(), reason: z.string().min(1).max(200).describe("e.g. 'replied: please stop'") },
  },
  recruit_search: {
    description: "Find individuals with a public work email for one job family, save them to the talent pool, and return the best candidates not invited in the last 30 days (person_id, name, headline, source, score, distance_km). Costs Monid credit; capped per call and per day in code.",
    shape: { family, limit: z.number().int().min(1).max(20).optional().describe("Max candidates returned (default 10).") },
  },
  recruit_invite: {
    description: "Email Operis's fixed invitation to join the worker pool (join link, the ID check every job needs, unsubscribe link) to people from recruit_search. The code enforces opt-outs, the 30-day rule, the daily cap and live/allowlist/dry-run mode. Returns counts, used_today against daily_cap, and a status per person.",
    shape: { family, person_ids: z.array(z.string().uuid()).min(1).max(20).describe("person_id values from recruit_search.") },
  },
  growth_report: {
    description: "Today's sends against the caps, search spend, the worker directory per family (found, invited, opted_in, id_verified, licensed, target, gap), job demand per family with a 7-day projection and the most requested job types, and free-first-job grants (granted, redeemed, due).",
    shape: {},
  },
  redeem_promo: {
    description: "CEO only. For a paid job whose customer holds a free-first-job grant: checks the grant, reserves it, and returns the exact operis.refund call to make (job_id, amount_cents, request_id, reason). Calling it again for the same job returns the same call.",
    shape: { job_id: z.string().uuid().describe("A paid job's id, from growth_report promos.due.") },
  },
};
