/**
 * Name normalisation and matching for certification checks. The CA listing prints names as
 * "LAST, FIRST MIDDLE" in capitals, while workers type "First Last" in mixed case, so both sides
 * are reduced to the same lower-case "first middle last" token form before comparing.
 */

/** Generational suffixes dropped so "John Smith Jr." matches a record without the suffix. */
export const NAME_SUFFIXES = ['jr', 'sr', 'ii', 'iii', 'iv'];

/** Lower-case, accent-free, letters-and-single-spaces form of a name, without suffixes. */
function cleanTokens(raw: string): string[] {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

const withoutSuffixes = (tokens: string[]): string[] => tokens.filter((t) => !NAME_SUFFIXES.includes(t));

/**
 * Canonical form used for both storage (name_normalized) and comparison. A comma means the
 * registry's "LAST, FIRST MIDDLE" order, so the part before it moves to the end. A trailing
 * ", Jr." is only a suffix, not a surname, so it does not trigger the swap.
 */
export function normalizeName(raw: string): string {
  const comma = raw.indexOf(',');
  if (comma >= 0) {
    const before = withoutSuffixes(cleanTokens(raw.slice(0, comma)));
    const after = withoutSuffixes(cleanTokens(raw.slice(comma + 1)));
    if (after.length > 0) return [...after, ...before].join(' ');
    return before.join(' ');
  }
  return withoutSuffixes(cleanTokens(raw)).join(' ');
}

export function nameTokens(raw: string): string[] {
  return normalizeName(raw).split(' ').filter(Boolean);
}

export type NameMatch = 'full' | 'partial' | 'none';

/** True when every token of `small` can be paired with a distinct equal token of `big`. */
function isSubMultiset(small: string[], big: string[]): boolean {
  const pool = [...big];
  for (const t of small) {
    const i = pool.indexOf(t);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}

/**
 * Compare the name a worker typed with the name on the registry record. Only 'full' may verify
 * automatically; 'partial' goes to a human, because initials and nicknames are plausible but
 * unproven, and a wrong auto-pass lets an unlicensed person notarise.
 */
export function matchNames(given: string, onRecord: string): { match: NameMatch; reason: string } {
  const a = nameTokens(given);
  const b = nameTokens(onRecord);
  if (a.length === 0 || b.length === 0) return { match: 'none', reason: 'empty name' };

  if (a.length === b.length && isSubMultiset(a, b)) {
    return { match: 'full', reason: 'same name tokens' };
  }

  if (a.length < 2 || b.length < 2) return { match: 'none', reason: 'names differ' };

  const firstA = a[0] as string;
  const firstB = b[0] as string;
  const lastA = a[a.length - 1] as string;
  const lastB = b[b.length - 1] as string;
  if (lastA !== lastB) return { match: 'none', reason: 'last names differ' };

  if (firstA === firstB) {
    const midA = a.slice(1, -1);
    const midB = b.slice(1, -1);
    if (isSubMultiset(midA, midB) || isSubMultiset(midB, midA)) {
      return { match: 'full', reason: 'same first and last name; middle name omitted on one side' };
    }
    return { match: 'partial', reason: 'same first and last name; middle names conflict' };
  }

  if (firstA.startsWith(firstB) || firstB.startsWith(firstA)) {
    const initial = Math.min(firstA.length, firstB.length) === 1;
    return {
      match: 'partial',
      reason: initial ? 'same last name; first name is an initial of the other' : 'same last name; first name is a prefix of the other',
    };
  }

  return { match: 'none', reason: 'first names differ' };
}
