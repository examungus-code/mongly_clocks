// Read-only filtering of sales for the Data page.
//
// A filter picks which transactions count. Its two parts are independent and
// combine: an optional festival and an optional calendar date range (null =
// no restriction). Dates are local calendar days as 'YYYY-MM-DD' strings so
// "May 3" means May 3 wherever the device is.
//
// Weekends: sessions are recorded per day, so per-weekend numbers group sale
// days around each Saturday. A day belongs to the weekend of the Saturday in
// its Tue–Mon week — so an opening Friday and a holiday Monday count with
// their weekend. Weekends are counted per festival: two festivals on the
// same weekend are two weekends worked. A session counts toward the weekend
// of the day it was started, however long it stayed open.

import type { ID, SessionRecord, Transaction } from '../db/schema';

export interface DateRange {
  start: string;
  end: string; // inclusive
}

export interface SalesFilter {
  festival_id: ID | null;
  range: DateRange | null;
}

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
  const { range } = filter;
  return !range || (day >= range.start && day <= range.end);
}

function festivalMatches(filter: SalesFilter, festival_id: ID | null): boolean {
  return filter.festival_id === null || festival_id === filter.festival_id;
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

/** One weekend worked at one festival, with what made it count. */
export interface WorkedWeekend {
  festival_id: ID | null;
  /** The weekend's Saturday, 'YYYY-MM-DD'. */
  saturday: string;
  /** Items sold per day ('YYYY-MM-DD'), for days with matching sales. */
  itemsByDay: Map<string, number>;
  /** Sessions started in this weekend, oldest first. */
  sessions: SessionRecord[];
}

/**
 * Weekends worked under the filter, oldest first. A weekend counts if any
 * matching sale happened in it, or a session was started in it (a day at the
 * booth with no sales still counts as a day worked). The per-weekend average
 * on the Data page divides by the length of this list.
 */
export function listWeekends(
  filter: SalesFilter,
  transactions: Pick<Transaction, 'id' | 'occurred_at' | 'festival_id'>[],
  sessions: SessionRecord[],
  itemsByTransaction: Map<ID, number>
): WorkedWeekend[] {
  const weekends = new Map<string, WorkedWeekend>();
  const weekendFor = (festival_id: ID | null, day: string) => {
    if (!festivalMatches(filter, festival_id) || !dayMatches(filter, day)) {
      return null;
    }
    const saturday = weekendKey(day);
    const key = `${festival_id ?? ''}|${saturday}`;
    let w = weekends.get(key);
    if (!w) {
      w = { festival_id, saturday, itemsByDay: new Map(), sessions: [] };
      weekends.set(key, w);
    }
    return w;
  };
  for (const tx of transactions) {
    const day = dayKey(tx.occurred_at);
    const w = weekendFor(tx.festival_id, day);
    if (!w) continue;
    const items = itemsByTransaction.get(tx.id) ?? 0;
    w.itemsByDay.set(day, (w.itemsByDay.get(day) ?? 0) + items);
  }
  for (const s of sessions) {
    weekendFor(s.festival_id, dayKey(s.started_at))?.sessions.push(s);
  }
  const list = Array.from(weekends.values());
  for (const w of list) w.sessions.sort((a, b) => a.started_at - b.started_at);
  list.sort(
    (a, b) =>
      a.saturday.localeCompare(b.saturday) ||
      String(a.festival_id).localeCompare(String(b.festival_id))
  );
  return list;
}
