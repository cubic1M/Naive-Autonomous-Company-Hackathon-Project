import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matchNames, normalizeName, nameTokens } from '../src/certs/names.js';
import { importNotaryListing, parseListingDate, parseNotaryListing, verifyNotary } from '../src/certs/notary.js';
import type { NotaryRecord } from '../src/types.js';
import { makeWorld, T0, WORKER_ID } from './helpers.js';

const csv = fs.readFileSync(new URL('./fixtures/notary-sample.csv', import.meta.url), 'utf8');
const tsv = fs.readFileSync(new URL('./fixtures/notary-sample.tsv', import.meta.url), 'utf8');

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('normalizeName / matchNames', () => {
  it('moves "LAST, FIRST MIDDLE" to first-middle-last', () => {
    expect(normalizeName('SMITH, JANE A')).toBe('jane a smith');
    expect(nameTokens('SMITH, JANE A')).toEqual(['jane', 'a', 'smith']);
  });

  it('strips accents, hyphens, punctuation and suffixes', () => {
    expect(normalizeName('GARCÍA, JOSÉ')).toBe('jose garcia');
    expect(normalizeName("O'BRIEN, MARY-ANNE K")).toBe('mary anne k o brien');
    expect(normalizeName('John Smith, Jr.')).toBe('john smith');
    expect(normalizeName('  John   Smith III ')).toBe('john smith');
  });

  const cases: [string, string, 'full' | 'partial' | 'none'][] = [
    ['José García', 'GARCÍA, JOSÉ', 'full'],
    ['John Smith Jr.', 'John Smith', 'full'],
    ['Jane Smith', 'Jane Marie Smith', 'full'],
    ['J Smith', 'Jane Smith', 'partial'],
    ['Jon Smith', 'Jonathan Smith', 'partial'],
    ['Jane A Smith', 'Jane B Smith', 'partial'],
    ['Jane Smith', 'Mary Smith', 'none'],
    ['Jane Smith', 'Jane Jones', 'none'],
    ['', 'Jane Smith', 'none'],
  ];
  it.each(cases)('%s vs %s -> %s', (given, onRecord, expected) => {
    const r = matchNames(given, onRecord);
    expect(r.match).toBe(expected);
    expect(r.reason.length).toBeGreaterThan(0);
  });
});

describe('parseListingDate', () => {
  it('parses every supported format to UTC midnight', () => {
    expect(parseListingDate('03/15/2028')).toEqual(utc(2028, 3, 15));
    expect(parseListingDate('3/5/2028')).toEqual(utc(2028, 3, 5));
    expect(parseListingDate('09/01/27')).toEqual(utc(2027, 9, 1));
    expect(parseListingDate('2028-03-15')).toEqual(utc(2028, 3, 15));
    expect(parseListingDate('20280315')).toEqual(utc(2028, 3, 15));
    expect(parseListingDate('Mar 15, 2028')).toEqual(utc(2028, 3, 15));
    expect(parseListingDate('March 5, 2028')).toEqual(utc(2028, 3, 5));
  });
  it('rejects garbage and impossible days', () => {
    expect(parseListingDate('not a date')).toBeNull();
    expect(parseListingDate('')).toBeNull();
    expect(parseListingDate('02/30/2028')).toBeNull();
    expect(parseListingDate('13/01/2028')).toBeNull();
  });
});

describe('parseNotaryListing', () => {
  it('parses the CSV fixture', () => {
    const r = parseNotaryListing(csv);
    expect(r.delimiter).toBe(',');
    expect(r.records).toHaveLength(8);
    expect(r.skipped).toEqual([{ line: 7, reason: expect.stringContaining('not a date') }]);

    const smith = r.records.find((x) => x.commission_number === '2301234');
    expect(smith?.business_name).toBe('Acme Notary, Inc.');
    expect(smith?.name_normalized).toBe('jane a smith');
    expect(smith?.commission_expires).toEqual(utc(2028, 3, 15));
    expect(smith?.raw['Business Name']).toBe('Acme Notary, Inc.');

    expect(r.records.find((x) => x.commission_number === '2305678')?.name_normalized).toBe('jose garcia');
    expect(r.records.find((x) => x.commission_number === '2305678')?.business_name).toBeNull();
    expect(r.records.find((x) => x.commission_number === '2309999')?.name_normalized).toBe('robert johnson');
    // "2311-111" -> dashes stripped; "09/01/27" -> 2027
    expect(r.records.find((x) => x.commission_number === '2311111')?.commission_expires).toEqual(utc(2027, 9, 1));
  });

  it('parses the TSV fixture with alternate headers and a BOM', () => {
    expect(tsv.charCodeAt(0)).toBe(0xfeff);
    const r = parseNotaryListing(tsv);
    expect(r.delimiter).toBe('\t');
    expect(r.headers[0]).toBe('Comm No');
    expect(r.records).toHaveLength(5);
    expect(r.skipped).toEqual([]);
    expect(r.records[0]).toMatchObject({
      commission_number: '4400001',
      full_name: 'Alice Wong',
      name_normalized: 'alice wong',
      county: 'Alameda',
      commission_expires: utc(2028, 5, 20),
    });
  });

  it('throws listing the headers when columns cannot be mapped, and accepts an explicit mapping', () => {
    const odd = 'Foo,Bar,Baz\n1,2,3\n';
    expect(() => parseNotaryListing(odd)).toThrow(/"Foo", "Bar", "Baz"/);
    expect(() => parseNotaryListing(odd)).toThrow(/commissionNumber/);

    const odd2 = 'Lic,Holder,Valid Until\nX-1,"DOE, JOHN",2030-01-02\n';
    const r = parseNotaryListing(odd2, {
      columns: { commissionNumber: ['Lic'], fullName: ['Holder'], expires: ['Valid Until'] },
    });
    expect(r.records[0]).toMatchObject({ commission_number: 'X1', name_normalized: 'john doe' });
  });

  it('honours an explicit delimiter and escaped quotes', () => {
    const r = parseNotaryListing('Commission Number;Name;Expiration Date\n9;"SAY ""HI"", BOB";2030-01-01\n', { delimiter: ';' });
    expect(r.records[0]?.full_name).toBe('SAY "HI", BOB');
  });
});

describe('importNotaryListing', () => {
  it('writes in batches and is idempotent', async () => {
    const world = makeWorld();
    const sizes: number[] = [];
    const original = world.repo.upsertNotaries.bind(world.repo);
    world.repo.upsertNotaries = async (records: NotaryRecord[]) => {
      sizes.push(records.length);
      await original(records);
    };

    const first = await importNotaryListing(world.repo, csv, { batchSize: 3 });
    expect(first.imported).toBe(8);
    expect(first.skipped).toHaveLength(1);
    expect(sizes).toEqual([3, 3, 2]);
    expect(world.repo.notaries.size).toBe(8);

    await importNotaryListing(world.repo, csv, { batchSize: 3 });
    expect(world.repo.notaries.size).toBe(8);
  });
});

describe('verifyNotary', () => {
  async function setup() {
    const world = makeWorld();
    await importNotaryListing(world.repo, csv);
    const verify = (commissionNumber: string, name: string, jobDate: Date) =>
      verifyNotary({ repo: world.repo, now: world.clock.now }, { workerId: WORKER_ID, commissionNumber, name, jobDate });
    const stored = () => world.repo.getWorkerVerification(WORKER_ID, 'notary_commission');
    return { world, verify, stored };
  }

  it('verifies a valid commission with an exact name', async () => {
    const { verify, stored } = await setup();
    const r = await verify('2301234', 'Jane A Smith', T0);
    expect(r).toMatchObject({ status: 'verified', reasons: [], nameMatch: 'full' });
    expect(await stored()).toMatchObject({
      status: 'verified',
      provider_ref: '2301234',
      verified_at: T0,
      expires_at: utc(2028, 3, 15),
      kind: 'notary_commission',
    });
  });

  it('fails an expired commission even with an exact name', async () => {
    const { verify, stored } = await setup();
    const r = await verify('2290001', 'Minh Nguyen', T0);
    expect(r.status).toBe('failed');
    expect(r.reasons).toEqual(['commission_expired']);
    expect(r.nameMatch).toBe('full');
    const row = await stored();
    expect(row?.status).toBe('failed');
    expect(row?.verified_at).toBeNull();
  });

  it('sends a partial name match to review', async () => {
    const { verify, stored } = await setup();
    const r = await verify('2301234', 'J Smith', T0);
    expect(r.status).toBe('needs_review');
    expect(r.reasons[0]).toMatch(/^name_partial_match: /);
    expect((await stored())?.status).toBe('needs_review');
  });

  it('fails a wrong name', async () => {
    const { verify } = await setup();
    const r = await verify('2301234', 'Mary Jones', T0);
    expect(r).toMatchObject({ status: 'failed', reasons: ['name_mismatch'], nameMatch: 'none' });
  });

  it('fails an unknown commission number and still records it', async () => {
    const { verify, stored } = await setup();
    const r = await verify('9999999', 'Jane Smith', T0);
    expect(r).toMatchObject({ status: 'failed', reasons: ['commission_not_found'], record: null });
    expect(await stored()).toMatchObject({ status: 'failed', expires_at: null, provider_ref: '9999999' });
  });

  it('is valid through the end of the expiration day, expired the day after', async () => {
    const { verify } = await setup();
    // Record 2314444 expires 06/30/2028. Noon and 11pm California time on that day are both fine.
    expect((await verify('2314444', 'Wei Chen', new Date('2028-06-30T19:00:00Z'))).status).toBe('verified');
    expect((await verify('2314444', 'Wei Chen', new Date('2028-07-01T06:00:00Z'))).status).toBe('verified'); // 11pm PDT on 06/30
    expect((await verify('2314444', 'Wei Chen', new Date('2028-07-01T08:00:00Z'))).reasons).toEqual(['commission_expired']); // 1am PDT 07/01
  });

  it('resolves a commission number given with dashes or spaces', async () => {
    const { verify } = await setup();
    expect((await verify('230-12 34', 'jane a smith', T0)).status).toBe('verified');
    expect((await verify('2311-111', 'Anita Patel', T0)).status).toBe('verified');
  });

  it('asks for review when the registry has no expiry date', async () => {
    const { world, verify } = await setup();
    await world.repo.upsertNotary({
      commission_number: 'NOEXP1', full_name: 'DOE, JANE', name_normalized: 'jane doe',
      county: null, city: null, business_name: null, commission_expires: null, raw: {},
    });
    const r = await verify('NOEXP1', 'Jane Doe', T0);
    expect(r).toMatchObject({ status: 'needs_review', reasons: ['expiry_unknown'] });
  });
});
