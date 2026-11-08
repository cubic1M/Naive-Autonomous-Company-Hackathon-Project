import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { classifyJob, demandFrom, targetFor } from '../src/demand.js';
import type { JobRow } from '../src/types.js';
import { NOW } from './helpers.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ZERO = { last_7d: 0, prior_7d: 0, projected_next_7d: 0, unfilled_7d: 0 };
const job = (over: Partial<JobRow>): JobRow => ({
  id: randomUUID(),
  title: 'Photograph the storefront',
  instructions: 'Take 3 photos',
  certification_required: null,
  lat: 37.7609,
  lng: -122.3875,
  remote: false,
  status: 'paid',
  worker_id: 'w1',
  created_at: NOW,
  updated_at: NOW,
  ...over,
});
const remote = { remote: true, lat: null, lng: null };

describe('classifyJob', () => {
  it('sorts jobs into families by what they ask for', () => {
    expect(classifyJob(job({ title: 'Notarize a lease' }))).toBe('sf_notaries');
    expect(classifyJob(job({ title: 'Sign papers', certification_required: 'notary public' }))).toBe('sf_notaries');
    expect(classifyJob(job({ title: 'Review our terms of service', ...remote }))).toBe('ca_attorneys');
    expect(classifyJob(job({ title: 'Fix our Next.js deploy', ...remote }))).toBe('developers');
    expect(classifyJob(job({}))).toBe('pier70_gigs');
    expect(classifyJob(job({ lat: 37.8044, lng: -122.2712 }))).toBe('other'); // Oakland, about 13 km away
    expect(classifyJob(job({ title: 'Translate a menu', ...remote }))).toBe('other');
  });
});

describe('demandFrom', () => {
  it('counts the last and prior week, projects growth and counts unfilled jobs', () => {
    const d = demandFrom(
      [
        job({ title: 'Notarize a lease', created_at: ago(2 * HOUR) }),
        job({ title: 'Notarize a deed', created_at: ago(3 * DAY), status: 'expired', worker_id: null }),
        job({ title: 'Notarize a will', created_at: ago(10 * DAY) }),
        job({ title: 'Hold a sign', created_at: ago(HOUR), status: 'outreach', worker_id: null, updated_at: ago(20 * MIN) }),
        job({ title: 'Hold a  Sign', created_at: ago(20 * DAY) }),
      ],
      NOW,
    );
    expect(d.by_family.sf_notaries).toEqual({ last_7d: 2, prior_7d: 1, projected_next_7d: 3, unfilled_7d: 1 });
    expect(d.by_family.pier70_gigs).toEqual({ last_7d: 1, prior_7d: 0, projected_next_7d: 2, unfilled_7d: 1 });
    expect(d.by_family.developers).toEqual(ZERO);
    expect(d.top_requested[0]).toEqual({ title: 'hold a sign', count: 2 });
  });

  it('holds a decline flat instead of projecting it down', () => {
    const d = demandFrom([job({ created_at: ago(DAY) }), job({ created_at: ago(8 * DAY) }), job({ created_at: ago(9 * DAY) })], NOW);
    expect(d.by_family.pier70_gigs).toMatchObject({ last_7d: 1, prior_7d: 2, projected_next_7d: 1 });
  });
});

describe('targetFor', () => {
  it('is 3 per expected job plus every unfilled job, between the floor and 60', () => {
    expect(targetFor('sf_notaries', { last_7d: 2, prior_7d: 1, projected_next_7d: 3, unfilled_7d: 1 })).toBe(12);
    expect(targetFor('pier70_gigs', ZERO)).toBe(15);
    expect(targetFor('developers', { ...ZERO, projected_next_7d: 40 })).toBe(60);
  });
});
