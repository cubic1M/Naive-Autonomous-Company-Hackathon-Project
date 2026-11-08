// Public surface of services/growth. apps/api uses ../index.ts (the binding); scripts and tests use this.
export * from './env.js';
export * from './types.js';
export * from './families.js';
export { GrowthTablesMissing, type GrowthRepo } from './repo.js';
export { MemoryGrowthRepo } from './repo/memory.js';
export { PostgresGrowthRepo, dbFromPostgresJs, type Db } from './repo/postgres.js';
export type { GrowthDeps } from './deps.js';
export { decide, RECENT_DAYS, type Decision } from './guard.js';
export { cleanPersonalLine, renderInvite, renderMarketing } from './templates.js';
export { joinUrl, signLink, unsubscribeUrl, verifyLink } from './links.js';
export { createGrowthTools, type GrowthTools } from './tools.js';
export { joinAction, joinPage, unsubscribePage, type PageResult } from './pages.js';
export { growthReport, type GrowthReport } from './report.js';
export { classifyJob, demandFrom, targetFor } from './demand.js';
export { promosDue, redeemPromo } from './redeem.js';
export { grantKeyFor } from './promo.js';
export { describeFound, recruitEnrichers } from './recruit.js';
