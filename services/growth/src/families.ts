/** The job families the Recruiter grows and demand is counted in (spec section 8). */
import type { SearchHints } from '../../outreach/src/types.js';

export type Family = 'pier70_gigs' | 'sf_notaries' | 'ca_attorneys' | 'developers';

/** The YC office at Pier 70, the demo job's location (the same point as services/outreach/scripts/seed-team.ts). */
export const PIER70 = { lat: 37.7609, lng: -122.3875, address: 'Pier 70, San Francisco, CA' } as const;
/** On-site radius around Pier 70, km (services/outreach's default OUTREACH_RADIUS_KM). */
export const RADIUS_KM = 8;

export interface FamilySpec {
  key: Family;
  /** Invite copy: "The work: <label>." */
  label: string;
  /** Invite subject after "Join Operis: ". */
  subject: string;
  /** Lowest pre-vetted target, whatever demand says (spec section 9). */
  floor: number;
  remote: boolean;
  /** Title of the scratch job recruit_search hands to find_people. */
  searchTitle: string;
  hints: SearchHints;
}

export const FAMILIES: Record<Family, FamilySpec> = {
  pier70_gigs: {
    key: 'pier70_gigs',
    label: 'short on-site jobs around Pier 70 and Dogpatch in San Francisco: event help, photos, deliveries and errands',
    subject: 'short paid jobs near Pier 70, San Francisco',
    floor: 15,
    remote: false,
    searchTitle: 'Event help, photos and deliveries near Pier 70',
    hints: {
      roles: ['brand ambassador', 'event staff', 'street team member', 'event photographer', 'courier', 'errand runner'],
      skills: ['events', 'photography', 'delivery'],
      credential: null,
      remote: false,
    },
  },
  sf_notaries: {
    key: 'sf_notaries',
    label: 'mobile notary signings in San Francisco',
    subject: 'paid notary signings in San Francisco',
    floor: 5,
    remote: false,
    searchTitle: 'Mobile notary for a signing in San Francisco',
    hints: {
      roles: ['mobile notary', 'notary signing agent', 'loan signing agent', 'notary public'],
      skills: ['notary public', 'loan signings'],
      credential: 'notary public',
      remote: false,
    },
  },
  ca_attorneys: {
    key: 'ca_attorneys',
    label: 'short remote legal reviews for startups: contracts, terms of service and privacy',
    subject: 'short paid legal reviews (remote)',
    floor: 5,
    remote: true,
    searchTitle: 'Review a SaaS contract under California law',
    hints: {
      roles: ['contract attorney', 'technology attorney', 'startup lawyer'],
      skills: ['SaaS', 'contracts', 'privacy', 'terms of service'],
      credential: 'California bar license',
      remote: true,
    },
  },
  developers: {
    key: 'developers',
    label: 'short paid coding help for AI hackathon teams: Next.js, React and TypeScript',
    subject: 'short paid coding jobs for AI teams (remote)',
    floor: 10,
    remote: true,
    searchTitle: 'Fix a Next.js and TypeScript bug',
    hints: {
      roles: ['Next.js developer', 'React developer', 'TypeScript developer', 'full stack developer'],
      skills: ['Next.js', 'React', 'TypeScript', 'Vercel'],
      credential: null,
      remote: true,
    },
  },
};

export const FAMILY_KEYS = Object.keys(FAMILIES) as Family[];
export const isFamily = (v: unknown): v is Family => typeof v === 'string' && Object.prototype.hasOwnProperty.call(FAMILIES, v);
