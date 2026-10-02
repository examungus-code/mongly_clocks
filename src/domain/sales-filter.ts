// Read-only filtering of sales for the Data page.
//
// A filter picks which transactions count: everything, a calendar date range,
// or one festival. Dates are local calendar days as 'YYYY-MM-DD' strings so
// "May 3" means May 3 wherever the device is.
//
// Weekends: sessions are recorded per day, so per-weekend numbers group sale
// days around each Saturday. A day belongs to the weekend of the Saturday in
// its Tue–Mon week — so an opening Friday and a holiday Monday count with
// their weekend. Weekends are counted per festival: two festivals on the
// same weekend are two weekends worked.

import type { ID, SessionRecord, Transaction } from '../db/schema';

export type SalesFilter =
  | { kind: 'all' }
  | { kind: 'range'; start: string; end: string } // inclusive
  | { kind: 'festival'; festival_id: ID };

/** Local calendar day of a timestamp, as 'YYYY-MM-DD'. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return formatDay(d.getFullYear(), d.getMonth(), d.getDate());
}

export function formatDay(year: number, month0: number, day: number): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${year}-${p(month0 + 1)}-${p(day)}`;
}

export function parseDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Days to add to reach the weekend's Saturday, indexed by getDay() (0 = Sun).
// Tue–Fri look ahead, Sun–Mon look back.
const TO_SATURDAY = [-1, -2, 4, 3, 2, 1, 0];

/** The Saturday ('YYYY-MM-DD') of the weekend a day belongs to. */
export function weekendKey(day: string): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + TO_SATURDAY[d.getDay()]);
  return formatDay(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayMatches(filter: SalesFilter, day: string): boolean {
  if (filter.kind !== 'range') return true;
  return day >= filter.start && day <= filter.end;
}

function festivalMatches(filter: SalesFilter, festival_id: ID | null): boolean {
  if (filter.kind !== 'festival') return true;
  return festival_id === filter.festival_id;
}

export function transactionMatches(
  filter: SalesFilter,
  tx: Pick<Transaction, 'occurred_at' | 'festival_id'>
): boolean {
  return (
    festivalMatches(filter, tx.festival_id) &&
    dayMatches(filter, dayKey(tx.occurred_at))
  );
}

/**
 * Number of weekends worked under the filter. A weekend counts if any
 * matching sale happened in it, or a session was started in it (a day at the
 * booth with no sales still counts as a day worked).
 */
export function countWeekends(
  filter: SalesFilter,
  transactions: Pick<Transaction, 'occurred_at' | 'festival_id'>[],
  sessions: Pick<SessionRecord, 'started_at' | 'festival_id'>[]
): number {
  const weekends = new Set<string>();
  const add = (festival_id: ID | null, ms: number) => {
    const day = dayKey(ms);
    if (!festivalMatches(filter, festival_id) || !dayMatches(filter, day)) {
      return;
    }
    weekends.add(`${festival_id ?? ''}|${weekendKey(day)}`);
  };
  for (const tx of transactions) add(tx.festival_id, tx.occurred_at);
  for (const s of sessions) add(s.festival_id, s.started_at);
  return weekends.size;
}
