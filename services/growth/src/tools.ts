/** The growth tools as plain functions over GrowthDeps: services/growth/index.ts serves them to the agents. */
import type { GrowthDeps } from './deps.js';
import { isFamily } from './families.js';
import { redeemPromo } from './redeem.js';
import { growthReport } from './report.js';
import { recruitInvite, recruitSearch } from './recruit.js';
import { listProspects, sendMarketing, suppressContact } from './sales.js';
import { postSocial } from './social.js';
import { SOCIAL_PLATFORMS, type SocialPlatform } from './types.js';

function platform(tool: string, v: string): SocialPlatform {
  if (!(SOCIAL_PLATFORMS as readonly string[]).includes(v)) throw new Error(`${tool}: unknown platform "${v}" (use ${SOCIAL_PLATFORMS.join(', ')})`);
  return v as SocialPlatform;
}

function family(tool: string, v: string) {
  if (!isFamily(v)) throw new Error(`${tool}: unknown family "${v}" (use pier70_gigs, sf_notaries, ca_attorneys or developers)`);
  return v;
}

export function createGrowthTools(deps: GrowthDeps) {
  return {
    list_prospects: async (input: { limit?: number } = {}) => listProspects(deps, input),
    send_marketing: async (input: { contact_id: string; personal_line?: string; offer_free_first_job?: boolean }) => sendMarketing(deps, input),
    suppress_contact: async (input: { email: string; reason: string }) => suppressContact(deps, input),
    post_social: async (input: { platform: string; text: string }) => postSocial(deps, { platform: platform('post_social', input.platform), text: input.text }),
    recruit_search: async (input: { family: string; limit?: number }) => recruitSearch(deps, { ...input, family: family('recruit_search', input.family) }),
    recruit_invite: async (input: { family: string; person_ids: string[] }) => recruitInvite(deps, { ...input, family: family('recruit_invite', input.family) }),
    growth_report: async () => growthReport(deps),
    redeem_promo: async (input: { job_id: string }) => redeemPromo(deps, input.job_id),
  };
}

export type GrowthTools = ReturnType<typeof createGrowthTools>;
