// Read-only filtering of sales for the Data page.
//
// A filter picks which transactions count. Its two parts are independent and
// combine: an optional festival and an optional calendar date range (null =
// no restriction). Dates are local calendar days as 'YYYY-MM-DD' strings so
// "May 3" means May 3 wherever the device is.
//
// Weekends: per-weekend numbers group sale days around each Saturday. A day
// belongs to the weekend of the Saturday in its Tue–Mon week — so an opening
// Friday and a holiday Monday count with their weekend. A weekend counts only
// if it has a sale, and counts once even when booths ran at more than one
// festival that weekend — so with all festivals selected, the average is the
// whole business's items per calendar weekend.

import type { ID, Transaction } from '../db/schema';

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

/** Sales on one day at one festival. */
export interface WeekendDay {
  day: string; // 'YYYY-MM-DD'
  festival_id: ID | null;
  items: number;
  /** Number of sales (transactions). */
  sales: number;
}

/** One calendar weekend with at least one matching sale. */
export interface WorkedWeekend {
  /** The weekend's Saturday, 'YYYY-MM-DD'. */
  saturday: string;
  /** Sales per day and festival, by day then festival. */
  days: WeekendDay[];
}

/**
 * Weekends worked under the filter, oldest first: every calendar weekend with
 * at least one matching sale, counted once however many festivals its sales
 * are tagged with. The per-weekend average on the Data page divides by the
 * length of this list.
 */
export function listWeekends(
  filter: SalesFilter,
  transactions: Pick<Transaction, 'id' | 'occurred_at' | 'festival_id'>[],
  itemsByTransaction: Map<ID, number>
): WorkedWeekend[] {
  const weekends = new Map<string, Map<string, WeekendDay>>();
  for (const tx of transactions) {
    const day = dayKey(tx.occurred_at);
    if (!festivalMatches(filter, tx.festival_id) || !dayMatches(filter, day)) {
      continue;
    }
    const saturday = weekendKey(day);
    let days = weekends.get(saturday);
    if (!days) {
      days = new Map();
      weekends.set(saturday, days);
    }
    const key = `${day}|${tx.festival_id ?? ''}`;
    let d = days.get(key);
    if (!d) {
      d = { day, festival_id: tx.festival_id, items: 0, sales: 0 };
      days.set(key, d);
    }
    d.items += itemsByTransaction.get(tx.id) ?? 0;
    d.sales += 1;
  }
  return Array.from(weekends.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([saturday, days]) => ({
      saturday,
      days: Array.from(days.values()).sort(
        (a, b) =>
          a.day.localeCompare(b.day) ||
          String(a.festival_id).localeCompare(String(b.festival_id))
      ),
    }));
}
