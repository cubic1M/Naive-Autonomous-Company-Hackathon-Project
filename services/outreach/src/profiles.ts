import type { Profile, ProfilePlatform } from './types.js';

/** Sites whose profile pages are individual people (or directories of individuals). */
const DIRECTORY_HOSTS = [
  'avvo.com',
  'justia.com',
  'lawyers.com',
  'martindale.com',
  'behance.net',
  'dribbble.com',
  'notaryrotary.com',
  '123notary.com',
  'thumbtack.com',
  'contra.com',
  'toptal.com',
  'stackoverflow.com',
];

/** Paths that are not a person (feeds, search, company pages, posts...). */
const NON_PROFILE = /^(search|explore|jobs|company|school|pulse|feed|posts?|hashtag|i|intent|share|settings|login|signup|about|help|topics|trending|events|groups|orgs|marketplace|sponsors|features|pricing|r)$/i;

/**
 * Turn a URL into a Profile when it points at one person. Returns null for non-profile pages.
 * Canonicalizes: lowercase host, no query/hash, no trailing slash, linkedin.com/in/<id>, x.com/<handle>.
 */
export function profileFromUrl(raw: string | null | undefined): Profile | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim().startsWith('http') ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.|[a-z]{2}\.)(?=linkedin\.com)/, '').replace(/^(www\.|m\.|mobile\.)/, '');
  const parts = u.pathname.split('/').filter(Boolean);
  const first = parts[0] ?? '';

  const make = (platform: ProfilePlatform, url: string, handle: string | null = null): Profile => ({ platform, url, handle });

  if (host === 'linkedin.com') {
    if (first === 'in' && parts[1]) return make('linkedin', `https://www.linkedin.com/in/${decodeURIComponent(parts[1]).toLowerCase()}`, parts[1].toLowerCase());
    return null;
  }
  if (host === 'github.com') {
    if (first && parts.length === 1 && !NON_PROFILE.test(first)) return make('github', `https://github.com/${first.toLowerCase()}`, first.toLowerCase());
    return null;
  }
  if (host === 'x.com' || host === 'twitter.com') {
    if (first && parts.length === 1 && !NON_PROFILE.test(first)) return make('x', `https://x.com/${first.toLowerCase()}`, first.toLowerCase());
    return null;
  }
  if (host === 'reddit.com' || host === 'old.reddit.com') {
    if ((first === 'user' || first === 'u') && parts[1]) return make('reddit', `https://www.reddit.com/user/${parts[1]}`, parts[1]);
    return null;
  }
  if (host === 'instagram.com') {
    if (first && parts.length === 1 && !NON_PROFILE.test(first) && first !== 'p' && first !== 'reel') {
      return make('instagram', `https://www.instagram.com/${first.toLowerCase()}`, first.toLowerCase());
    }
    return null;
  }
  const dir = DIRECTORY_HOSTS.find((d) => host === d || host.endsWith(`.${d}`));
  if (dir) {
    if (!parts.length) return null;
    return make('directory', `https://${host}${u.pathname.replace(/\/+$/, '')}`);
  }
  // Anything else: a personal/portfolio website (root only, so one person = one site).
  if (/\.(com|net|org|io|dev|me|co|design|studio|photo|photography|law|art|xyz|app|site|page)$/.test(host)) {
    return make('website', `https://${host}`);
  }
  return null;
}

/** Stable key fragments for identity matching across sources. */
export function profileKeys(profiles: Profile[] | undefined): string[] {
  return (profiles ?? []).map((p) => (p.handle && p.platform !== 'website' && p.platform !== 'directory' ? `${p.platform}:${p.handle}` : `${p.platform}:${p.url}`));
}

/** Merge profile lists, dropping duplicates by URL. */
export function mergeProfiles(a: Profile[] | undefined, b: Profile[] | undefined): Profile[] {
  const out: Profile[] = [];
  for (const p of [...(a ?? []), ...(b ?? [])]) if (!out.some((o) => o.url === p.url)) out.push(p);
  return out;
}
