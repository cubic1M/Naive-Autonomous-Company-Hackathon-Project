import type { JobForOutreach, SearchHints } from './types.js';

export interface SearchPlan {
  /** true = online work anywhere (no distance limit); false = on-site near the job. */
  remote: boolean;
  /** Job titles to look for, e.g. ["contract attorney", "paralegal"]. */
  roles: string[];
  /** Skills / keywords. */
  skills: string[];
  /** Required credential, e.g. "California bar license". */
  credential: string | null;
  /** Google Maps searches (businesses are only a backup for on-site jobs; empty for remote). */
  mapsQueries: string[];
  /** City / area for on-site jobs; null for remote. */
  locationText: string | null;
}

type PlanJob = Pick<JobForOutreach, 'title' | 'instructions' | 'certification_required'> &
  Partial<Pick<JobForOutreach, 'address' | 'lat' | 'lng' | 'remote'>>;

interface Family {
  pattern: RegExp;
  roles: string[];
  skills?: string[];
  maps?: string[];
}

/** On-site gig families: people nearby; Maps businesses are the backup. */
const ONSITE: Family[] = [
  { pattern: /\b(signs?|sign[- ]holding|flyers?|fliers?|leaflets?|handouts?|promo(tion(al)?)?|brand ambassadors?|street team)\b/, roles: ['brand ambassador', 'street team member'], maps: ['event staffing', 'promotional staffing'] },
  { pattern: /\b(photograph\w*|photos?|videograph\w*|filming|footage|videos?)\b/, roles: ['photographer'], maps: ['photographer'] },
  { pattern: /\b(deliver\w*|pick ?up|couriers?|ship\w*|drop ?off|errands?)\b/, roles: ['courier', 'delivery driver'], maps: ['courier service'] },
  { pattern: /\b(notary|notarize|notarization)\b/, roles: ['notary public', 'mobile notary'], maps: ['notary public'] },
  { pattern: /\b(moving|movers?|lift\w*|haul\w*|furniture)\b/, roles: ['mover', 'moving helper'], maps: ['moving help'] },
  { pattern: /\b(clean\w*|janitor\w*|tidy)\b/, roles: ['cleaner'], maps: ['cleaning service'] },
];

/** Online work families: anyone in the world, ranked by fit. */
const REMOTE: Family[] = [
  { pattern: /\b(legal|attorneys?|lawyers?|paralegals?|counsel|nda|terms of service|privacy policy|contracts?|trademark|gdpr)\b/, roles: ['contract attorney', 'paralegal'] },
  { pattern: /\b(code|coding|software|developers?|programm\w*|bugs?|pull request|prs?|react|python|typescript|javascript|frontend|backend|full[- ]?stack|web ?sites?|apis?|devops)\b/, roles: ['software engineer'] },
  { pattern: /\b(logos?|graphic design\w*|designers?|branding|illustrat\w*|ui|ux|figma|banners?|mockups?)\b/, roles: ['graphic designer', 'logo designer'] },
  { pattern: /\b(copywrit\w*|blog|articles?|writers?|writing|proofread\w*|content writ\w*|ghostwrit\w*)\b/, roles: ['copywriter', 'content writer'] },
  { pattern: /\b(translat\w*|interpret\w*|localiz\w*)\b/, roles: ['translator'] },
  { pattern: /\b(bookkeep\w*|accounting|accountants?|quickbooks|taxes|tax return|invoices?)\b/, roles: ['bookkeeper', 'accountant'] },
  { pattern: /\b(data (analysis|analyst|entry|cleaning|labell?ing)|spreadsheets?|excel|sql|dashboards?)\b/, roles: ['data analyst'] },
  { pattern: /\b(seo|marketing|social media|ppc|newsletters?|email campaigns?)\b/, roles: ['digital marketer', 'SEO specialist'] },
  { pattern: /\b(video edit\w*|edit(ing)? (a |the )?videos?|motion graphics|premiere|after effects)\b/, roles: ['video editor'] },
  { pattern: /\b(virtual assistants?|admin(istrative)? support|inbox|scheduling|calendar management)\b/, roles: ['virtual assistant'] },
  { pattern: /\b(research\w*|market research|literature review)\b/, roles: ['researcher'] },
  { pattern: /\b(tutor\w*|lessons?|teach\w*|coach\w*)\b/, roles: ['tutor'] },
];

const SOFTWARE_STACK: [RegExp, string][] = [
  [/\breact\b/, 'React'], [/\bvue\b/, 'Vue'], [/\bangular\b/, 'Angular'], [/\bnext\.?js\b/, 'Next.js'], [/\bnode(\.?js)?\b/, 'Node.js'],
  [/\btypescript\b/, 'TypeScript'], [/\bjavascript\b/, 'JavaScript'], [/\bpython\b/, 'Python'], [/\bdjango\b/, 'Django'],
  [/\brust\b/, 'Rust'], [/\bjava\b/, 'Java'], [/\bswift\b/, 'Swift'], [/\bkotlin\b/, 'Kotlin'], [/\bflutter\b/, 'Flutter'],
  [/\bpostgres(ql)?\b/, 'PostgreSQL'], [/\bsql\b/, 'SQL'], [/\baws\b/, 'AWS'], [/\bdocker\b/, 'Docker'], [/\bgolang\b/, 'Go'],
];

const LEGAL_WORDS: [RegExp, string][] = [
  [/\bsaas\b/, 'SaaS'], [/\bprivacy\b/, 'privacy'], [/\bterms of service\b/, 'terms of service'], [/\bnda\b/, 'NDA'],
  [/\btrademark\b/, 'trademark'], [/\bemployment\b/, 'employment law'], [/\bimmigration\b/, 'immigration'], [/\bgdpr\b/, 'GDPR'],
  [/\bcontracts?\b/, 'contract review'],
];

const LANGUAGES = [
  'spanish', 'french', 'german', 'italian', 'portuguese', 'chinese', 'mandarin', 'cantonese', 'japanese', 'korean', 'arabic',
  'russian', 'hindi', 'dutch', 'polish', 'turkish', 'vietnamese', 'tagalog', 'swedish', 'hebrew', 'ukrainian',
];

const REMOTE_CUES = /\b(remote(ly)?|online|virtual(ly)?|zoom|work from home|over email|via email|digital|pdf|google docs?|this document|this contract)\b/;

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** City / area text from a free-form address ("123 Main St, San Francisco, CA 94105" -> "San Francisco"). */
export function cityFromAddress(address: string | null | undefined): string | null {
  if (!address?.trim()) return null;
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  const keep = parts.filter((p) => !/^\d/.test(p) && !/^[A-Za-z]{2}(\s+\d{4,5}(-\d{4})?)?$/.test(p) && !/^(usa|us|united states)$/i.test(p));
  return keep[keep.length - 1] ?? parts[parts.length - 1] ?? null;
}

/**
 * Who to look for. Agent hints win; otherwise a broad heuristic over title + instructions.
 * Remote = online work (no distance limit); on-site = people near the job, Maps businesses as backup.
 */
export function planSearch(job: PlanJob, hints: SearchHints = {}): SearchPlan {
  const text = `${job.title} ${job.instructions}`.toLowerCase();
  const onsiteText = text.replace(/\b(video edit\w*|edit(ing)? (a |the )?videos?)\b/g, ' ');
  const onsite = ONSITE.filter((f) => f.pattern.test(onsiteText));
  const online = REMOTE.filter((f) => f.pattern.test(text));

  const remote =
    hints.remote ??
    (job.remote === true || job.lat == null || (onsite.length === 0 && (online.length > 0 || REMOTE_CUES.test(text))));

  const hRoles = uniq(hints.roles ?? []);
  const hSkills = uniq(hints.skills ?? []);
  const credential = hints.credential !== undefined ? hints.credential?.trim() || null : job.certification_required?.trim() || null;

  const fams = remote ? online : onsite;
  let heurRoles = uniq(fams.flatMap((f) => f.roles));
  const heurSkills: string[] = [];
  if (remote) {
    if (online.some((f) => f.roles.includes('software engineer'))) {
      for (const [re, name] of SOFTWARE_STACK) if (re.test(text)) heurSkills.push(name);
    }
    if (online.some((f) => f.roles.includes('contract attorney'))) {
      for (const [re, name] of LEGAL_WORDS) if (re.test(text)) heurSkills.push(name);
    }
    if (online.some((f) => f.roles.includes('translator'))) {
      const lang = LANGUAGES.find((l) => new RegExp(`\\b${l}\\b`).test(text));
      if (lang) heurRoles = [`${cap(lang)} translator`, 'translator'];
    }
    if (heurRoles.length === 0) heurRoles = [job.title.trim()].filter(Boolean);
  } else if (heurRoles.length === 0) {
    heurRoles = ['gig worker'];
  }

  let mapsQueries: string[] = [];
  if (!remote) {
    const maxBase = credential ? 2 : 3;
    const base = uniq(onsite.flatMap((f) => f.maps ?? []));
    const out = uniq([...(base.length ? base : hRoles.length ? [] : ['staffing agency', 'temp agency']), ...hRoles]).slice(0, maxBase);
    if (out.length === 0) out.push('staffing agency', 'temp agency');
    if (credential && !out.includes(credential)) out.push(credential);
    mapsQueries = out.slice(0, 3);
  }

  return {
    remote,
    roles: hRoles.length ? hRoles : heurRoles,
    skills: hSkills.length ? hSkills : uniq(heurSkills),
    credential,
    mapsQueries,
    locationText: remote ? null : cityFromAddress(job.address),
  };
}

/** Backwards compatible: Google Maps searches for an on-site job. */
export function planQueries(job: PlanJob): string[] {
  return planSearch(job, { remote: false }).mapsQueries;
}
