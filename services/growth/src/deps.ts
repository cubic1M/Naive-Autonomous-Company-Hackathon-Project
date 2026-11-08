import type { Monid } from '../../outreach/src/monid.js';
import type { Repo as PoolRepo } from '../../outreach/src/repo.js';
import type { EmailSender } from '../../outreach/src/senders.js';
import type { Enricher, SourceAdapter } from '../../outreach/src/sources/types.js';
import type { GrowthEnv } from './env.js';
import type { GrowthRepo } from './repo.js';
import type { SocialPublisher } from './social.js';

/** What every growth operation needs. services/growth/index.ts builds it for apps/api; tests build it by hand. */
export interface GrowthDeps {
  env: GrowthEnv;
  repo: GrowthRepo;
  /** Andrew's talent pool (workers + worker_profiles): save found people, opt in, opt out, look up by email. */
  pool: Pick<PoolRepo, 'upsertLead' | 'setRegular' | 'optOut' | 'findByContact'>;
  /** A missing sender makes that kind of real send fail with reason no_sender (dry runs still work). */
  senders: { sales?: EmailSender; recruit?: EmailSender };
  /** Needed by recruit_search and reddit_research only. */
  monid?: Monid;
  /** post_social's publisher (Zernio). Missing: real posts fail with reason not_configured (dry runs still work). */
  social?: SocialPublisher;
  /** Cameron's Stripe Identity link (services/verify createIdentityLink); url null when already verified. */
  identity?: (workerId: string) => Promise<{ url: string | null; status: string }>;
  now: () => Date;
  /** Test overrides for recruit_search's people search. */
  search?: { sources?: SourceAdapter[]; enrichers?: Enricher[] };
}
