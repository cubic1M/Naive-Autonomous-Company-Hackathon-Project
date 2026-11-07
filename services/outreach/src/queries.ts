import type { JobForOutreach } from './types.js';

const TABLE: { pattern: RegExp; queries: string[] }[] = [
  { pattern: /\b(signs?|sign[- ]holding|flyers?|fliers?|leaflets?|handouts?|promo(tion(al)?)?|brand ambassadors?|street team)\b/, queries: ['event staffing', 'promotional staffing'] },
  { pattern: /\b(photograph\w*|photos?|videos?|videograph\w*|filming|footage)\b/, queries: ['photographer'] },
  { pattern: /\b(deliver\w*|pick ?up|couriers?|ship\w*|drop ?off|errands?)\b/, queries: ['courier service'] },
  { pattern: /\b(notary|notarize|notarization)\b/, queries: ['notary public'] },
  { pattern: /\b(moving|movers?|lift\w*|haul\w*|furniture)\b/, queries: ['moving help'] },
  { pattern: /\b(clean\w*|janitor\w*|tidy)\b/, queries: ['cleaning service'] },
];

const DEFAULT = ['staffing agency', 'temp agency'];

/** Deterministic mapping from a job to 1-3 Google Maps search strings. */
export function planQueries(job: Pick<JobForOutreach, 'title' | 'instructions' | 'certification_required'>): string[] {
  const text = `${job.title} ${job.instructions}`.toLowerCase();
  const cert = job.certification_required?.trim() || null;
  const maxBase = cert ? 2 : 3;
  const base: string[] = [];
  for (const row of TABLE) {
    if (row.pattern.test(text)) for (const q of row.queries) if (!base.includes(q)) base.push(q);
  }
  const out = (base.length ? base : DEFAULT).slice(0, maxBase);
  if (cert && !out.includes(cert)) out.push(cert);
  return out;
}
