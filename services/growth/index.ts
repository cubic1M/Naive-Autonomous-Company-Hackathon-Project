// Growth tools for apps/api's registry (apps/api/src/tools/registry.ts) and the /v1/growth/* routes.
// Logic lives in ./src; this file binds it to the API's database (postgres.js), environment, senders and
// Cameron's Stripe Identity link. Spec: docs/specs/2026-11-08-sales-recruiter-design.md.
import type { ServiceModule, ToolContext } from "../../contracts/runtime";
import { HttpMonid, NaiveEmailSender, PostgresRepo, type EmailSender, type Monid } from "../outreach/src/index";
import { MonidEmailSender } from "../outreach/src/senders";
import { createIdentityLink } from "../verify/index";
import {
  createGrowthTools,
  dbFromPostgresJs,
  growthEnvFromProcess,
  joinAction,
  joinPage,
  PostgresGrowthRepo,
  unsubscribePage,
  ZernioPublisher,
  type GrowthDeps,
  type GrowthEnv,
  type PageResult,
} from "./src/index";

function salesSender(env: GrowthEnv, monid: Monid | undefined): EmailSender | undefined {
  if (env.NAIVE_API_KEY && env.GROWTH_SALES_NAIVE_IDENTITY_ID && env.GROWTH_SALES_NAIVE_INBOX_ID) {
    return new NaiveEmailSender({ apiKey: env.NAIVE_API_KEY, baseUrl: env.NAIVE_BASE_URL, identityId: env.GROWTH_SALES_NAIVE_IDENTITY_ID, inboxId: env.GROWTH_SALES_NAIVE_INBOX_ID });
  }
  return monid && env.GROWTH_SALES_AGENTMAIL_INBOX ? new MonidEmailSender(monid, env.GROWTH_SALES_AGENTMAIL_INBOX) : undefined;
}

/** post_social's publisher: Zernio with Operis's own account on each platform. Without a key, real posts fail as not_configured. */
function socialPublisher(env: GrowthEnv): ZernioPublisher | undefined {
  if (!env.ZERNIO_API_KEY) return undefined;
  return new ZernioPublisher({
    apiKey: env.ZERNIO_API_KEY,
    accounts: { x: env.ZERNIO_X_ACCOUNT_ID ?? undefined, threads: env.ZERNIO_THREADS_ACCOUNT_ID ?? undefined, bluesky: env.ZERNIO_BLUESKY_ACCOUNT_ID ?? undefined },
  });
}

/** `sql` is apps/api's postgres.js client (apps/api/src/lib/db.ts). */
export function growthDeps(sql: any): GrowthDeps {
  const env = growthEnvFromProcess();
  const monid = env.MONID_API_KEY ? new HttpMonid(env.MONID_API_KEY, env.MONID_BASE_URL) : undefined;
  return {
    env,
    repo: new PostgresGrowthRepo(dbFromPostgresJs(sql)),
    pool: new PostgresRepo(sql),
    senders: {
      sales: salesSender(env, monid),
      recruit: monid && env.GROWTH_RECRUIT_AGENTMAIL_INBOX ? new MonidEmailSender(monid, env.GROWTH_RECRUIT_AGENTMAIL_INBOX) : undefined,
    },
    monid,
    social: socialPublisher(env),
    identity: (workerId: string) => createIdentityLink(workerId),
    now: () => new Date(),
  };
}

const tools = (ctx: ToolContext) => createGrowthTools(growthDeps(ctx.sql));

const growth: ServiceModule = {
  list_prospects: (input, ctx) => tools(ctx).list_prospects(input),
  send_marketing: (input, ctx) => tools(ctx).send_marketing(input),
  suppress_contact: (input, ctx) => tools(ctx).suppress_contact(input),
  post_social: (input, ctx) => tools(ctx).post_social(input),
  recruit_search: (input, ctx) => tools(ctx).recruit_search(input),
  recruit_invite: (input, ctx) => tools(ctx).recruit_invite(input),
  growth_report: (_input, ctx) => tools(ctx).growth_report(),
  redeem_promo: (input, ctx) => tools(ctx).redeem_promo(input),
  reddit_research: (input, ctx) => tools(ctx).reddit_research(input),
};
export default growth;

export const growthUnsubscribe = (sql: any, token: string | null): Promise<PageResult> => unsubscribePage(growthDeps(sql), token);
export const growthJoinPage = (sql: any, token: string | null): Promise<PageResult> => joinPage(growthDeps(sql), token);
export const growthJoinAction = (sql: any, token: string | null, action: string): Promise<PageResult> => joinAction(growthDeps(sql), token, action);

/** A page or redirect as an HTTP response: no caching, no referrer (the token is in the URL), not indexed. */
export function pageResponse(r: PageResult): Response {
  if ("redirect" in r) return new Response(null, { status: 303, headers: { Location: r.redirect, "Cache-Control": "no-store" } });
  return new Response(r.html, {
    status: r.status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" },
  });
}
