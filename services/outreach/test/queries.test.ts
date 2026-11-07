import { describe, expect, it } from 'vitest';
import { planQueries } from '../src/queries.js';

const j = (title: string, instructions = '', cert: string | null = null) => ({ title, instructions, certification_required: cert });

describe('planQueries', () => {
  it('sign holding -> event staffing', () => {
    expect(planQueries(j('Hold a sign near the YC office'))).toEqual(['event staffing', 'promotional staffing']);
  });
  it('photo / courier / notary / moving / cleaning', () => {
    expect(planQueries(j('Take photos of storefront'))).toEqual(['photographer']);
    expect(planQueries(j('Pickup a package and deliver it'))).toEqual(['courier service']);
    expect(planQueries(j('Notarize a document'))).toEqual(['notary public']);
    expect(planQueries(j('Help lift a couch'))).toEqual(['moving help']);
    expect(planQueries(j('Office cleaning'))).toEqual(['cleaning service']);
  });
  it('defaults to staffing', () => {
    expect(planQueries(j('Do a thing'))).toEqual(['staffing agency', 'temp agency']);
  });
  it('adds certification phrase, max 3 total', () => {
    const q = planQueries(j('Photograph and deliver and hold a sign', '', 'Notary Public'));
    expect(q).toHaveLength(3);
    expect(q[2]).toBe('Notary Public');
  });
  it('does not match "design"', () => {
    expect(planQueries(j('Design review'))).toEqual(['staffing agency', 'temp agency']);
  });
});
