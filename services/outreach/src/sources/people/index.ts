import type { SourceAdapter } from '../types.js';
import { googleProfiles } from './googleProfiles.js';
import { linkedinPeople } from './linkedinPeople.js';
import { peopleSearch } from './peopleSearch.js';
import { redditForHire } from './redditForHire.js';
import { xUsers } from './xUsers.js';

/** Individual-finding sources, run for every job (remote and on-site). Cheapest first. */
export const peopleSources: SourceAdapter[] = [googleProfiles, xUsers, redditForHire, peopleSearch, linkedinPeople];
