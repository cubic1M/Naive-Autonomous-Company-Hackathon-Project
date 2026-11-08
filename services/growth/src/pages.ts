/**
 * The pages behind the links in growth emails (apps/api/src/app/v1/growth/*). Unsubscribe is one click, no login.
 * The join page changes nothing on GET (email link scanners fetch links too); its buttons POST.
 */
import type { GrowthDeps } from './deps.js';
import { verifyLink } from './links.js';
import { isOptedOut, optOutEverywhere } from './optout.js';
import { firstNameOf } from './templates.js';
import type { Contact } from './types.js';

/** What a route returns: an HTML page, or a redirect (to Stripe Identity). */
export type PageResult = { status: number; html: string } | { redirect: string };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const para = (t: string) => `<p>${esc(t)}</p>`;
const muted = (t: string) => `<p class="muted">${esc(t)}</p>`;
const WAY_OUT = 'Email ops@operis.live and we will take you off our lists by hand.';

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · Operis</title><style>body{margin:0;background:#fbfaf6;color:#2f3a33;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}main{max-width:520px;margin:0 auto;padding:48px 20px}.brand{font:700 18px Georgia,"Times New Roman",serif;margin-bottom:28px}h1{font:600 28px/1.2 Georgia,"Times New Roman",serif;margin:0 0 14px}p{margin:0 0 14px}form{margin:22px 0}button{background:#46664f;color:#f4f1e8;border:0;border-radius:999px;padding:13px 28px;font:700 13px/1 -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:1.2px;text-transform:uppercase;cursor:pointer}.muted{color:#8a8f8a;font-size:13px}</style></head><body><main><div class="brand">Operis</div><h1>${esc(title)}</h1>${body}</main></body></html>`;
}

const button = (token: string, action: 'opt_in' | 'identity', label: string) =>
  `<form method="post" action="/v1/growth/join"><input type="hidden" name="t" value="${esc(token)}"><input type="hidden" name="action" value="${action}"><button type="submit">${esc(label)}</button></form>`;
const identityStep = (token: string) =>
  para('One more step: verify your ID once with Stripe (about 2 minutes). You need a verified ID before you can take any job.') +
  button(token, 'identity', 'Verify my ID');
const html = (status: number, title: string, body: string): PageResult => ({ status, html: page(title, body) });
const unsubscribed = () => html(200, 'You unsubscribed', para("You asked us not to contact you, so we won't send you jobs. Changed your mind? Email ops@operis.live."));
const badJoinLink = () => html(400, 'This link has expired', para('Join links last 30 days. Use the link in a newer invitation from us, or email ops@operis.live.'));

/** The recruit a valid, unexpired join token points at, or null. */
async function recruitFor(deps: GrowthDeps, token: string | null): Promise<Contact | null> {
  const id = verifyLink(deps.env.LINK_SIGNING_SECRET, token, 'join', deps.now());
  const c = id ? await deps.repo.getContact(id) : null;
  return c && c.kind === 'recruit' && c.worker_id ? c : null;
}

/** GET or POST /v1/growth/unsubscribe?t=… */
export async function unsubscribePage(deps: GrowthDeps, token: string | null): Promise<PageResult> {
  const id = verifyLink(deps.env.LINK_SIGNING_SECRET, token, 'unsubscribe', deps.now());
  const c = id ? await deps.repo.getContact(id) : null;
  if (!c) return html(400, 'We could not read this link', para(`The unsubscribe link looks incomplete. ${WAY_OUT}`));
  await optOutEverywhere(deps, c.email);
  await deps.repo.log({ contact_id: c.id, kind: 'unsubscribe', status: 'ok' });
  return html(200, "You're unsubscribed", para('We will not email you again, about jobs or anything else.') + muted('Operis · operis.live'));
}

/** GET /v1/growth/join?t=… */
export async function joinPage(deps: GrowthDeps, token: string | null): Promise<PageResult> {
  const c = await recruitFor(deps, token);
  if (!c || !token) return badJoinLink();
  if (c.opted_out || (await isOptedOut(deps, c.email))) return unsubscribed();
  if (c.joined_at) return html(200, "You're in", para('We will email you job offers that fit you.') + identityStep(token));
  const first = firstNameOf(c.name);
  return html(
    200,
    'Get job offers from Operis',
    para(`Hi ${first ?? 'there'}, Operis offers short, paid jobs from AI agents and businesses. Join to get offers by email: no account and no fee, and you take only the jobs you want.`) +
      button(token, 'opt_in', 'Yes, send me jobs') +
      muted('Every email from us has a one-click unsubscribe link.'),
  );
}

/** POST /v1/growth/join with t and action: opt_in makes the person a regular in Andrew's pool; identity starts Stripe Identity. */
export async function joinAction(deps: GrowthDeps, token: string | null, action: string): Promise<PageResult> {
  const c = await recruitFor(deps, token);
  if (!c || !token || !c.worker_id) return badJoinLink();
  if (c.opted_out || (await isOptedOut(deps, c.email))) return unsubscribed();
  if (action === 'opt_in') {
    await deps.pool.setRegular(c.worker_id, true);
    await deps.repo.markJoined(c.id, deps.now());
    await deps.repo.log({ contact_id: c.id, kind: 'join', status: 'ok', family: c.family });
    return html(200, "You're in", para('Thanks. We will email you job offers that fit you; take only the ones you want.') + identityStep(token));
  }
  if (action === 'identity') {
    if (!c.joined_at) return html(409, 'Join first', para('Join first, then verify your ID.') + button(token, 'opt_in', 'Yes, send me jobs'));
    if (!deps.identity) return html(503, 'ID check unavailable', para("We couldn't start the ID check right now. Please try again later."));
    try {
      const r = await deps.identity(c.worker_id);
      await deps.repo.log({ contact_id: c.id, kind: 'identity', status: 'ok', reason: r.status });
      return r.url ? { redirect: r.url } : html(200, 'Your ID is verified', para('Nothing more to do. We will email you job offers that fit you.'));
    } catch (e) {
      await deps.repo.log({ contact_id: c.id, kind: 'identity', status: 'failed', reason: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
      return html(502, 'ID check unavailable', para("We couldn't start the ID check. Please try again later."));
    }
  }
  return html(400, 'Unknown action', para('Please use the buttons on the page.'));
}
