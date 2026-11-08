/** Time helpers. "Today" for caps and budgets is the Pacific day: Operis runs in San Francisco. */
export const DAY_MS = 86_400_000;

const PT = 'America/Los_Angeles';

/** Midnight Pacific time of the day containing `now` (up to an hour off on the two DST change days). */
export function pacificDayStart(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PT,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const msIntoDay = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + now.getUTCMilliseconds();
  return new Date(now.getTime() - msIntoDay);
}

/** YYYY-MM-DD in Pacific time. */
export function pacificDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PT, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** "Sun Nov 22" in Pacific time, for email copy. */
export function shortDate(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: PT, weekday: 'short', month: 'short', day: 'numeric' }).format(d).replace(',', '');
}
