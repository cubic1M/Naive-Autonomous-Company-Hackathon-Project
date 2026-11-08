// OWNED BY workstream B (contact discovery). find.ts imports `personEnrichers`.
import type { Enricher } from '../sources/types.js';
import { githubProfile } from './githubProfile.js';
import { instagramContact } from './instagramContact.js';
import { linkedinWorkEmail } from './linkedinWorkEmail.js';
import { webPresence } from './webPresence.js';
import { websiteContact } from './websiteContact.js';
import { xBio } from './xBio.js';

export { githubProfile, makeGithubProfile } from './githubProfile.js';
export { instagramContact } from './instagramContact.js';
export { linkedinWorkEmail } from './linkedinWorkEmail.js';
export { webPresence } from './webPresence.js';
export { websiteContact } from './websiteContact.js';
export { xBio } from './xBio.js';
export type { EnrichResult, PersonEnricher } from './util.js';

/**
 * Contact enrichers for individuals, cheapest first. Work/public contacts only: never personal-email lookups.
 * Each has applies(); callers should stop at the first one that returns an email. Results may also carry
 * profiles (+ optional open_to_work / headline / location_text) to merge into the lead.
 */
export const personEnrichers: Enricher[] = [githubProfile, xBio, instagramContact, websiteContact, webPresence, linkedinWorkEmail];
