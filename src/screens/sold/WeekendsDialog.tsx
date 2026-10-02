// Lists the weekends the Data page's per-weekend average divides by, with
// what made each one count: days with sales and the sessions started in it.
// Flags the two ways a weekend gets counted without real selling: a session
// started with no sales, and a session started mid-week.

import { useEffect, useRef } from 'react';
import type { Festival, ID } from '../../db/schema';
import { parseDay, type WorkedWeekend } from '../../domain/sales-filter';

interface Props {
  weekends: WorkedWeekend[];
  festivalsById: Map<ID, Festival>;
  /** Show each weekend's festival (when the page isn't filtered to one). */
  showFestival: boolean;
  onClose: () => void;
}

export function WeekendsDialog({
  weekends,
  festivalsById,
  showFestival,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="rounded-lg p-0 bg-white text-walnut border border-brass/40 shadow-xl backdrop:bg-black/50 w-[min(560px,calc(100vw-2rem))]"
    >
      <div className="p-5 space-y-3 max-h-[85vh] overflow-y-auto">
        <header className="flex items-start justify-between gap-3">
          <h3 className="text-xl font-display">
            {weekends.length} weekend{weekends.length === 1 ? '' : 's'} counted
          </h3>
          <button
            type="button"
            className="text-walnut/60 hover:text-walnut"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <p className="text-xs text-walnut/70">
          The per-weekend averages divide by this many weekends. A weekend
          (Friday–Monday around a Saturday) counts if there was a sale in it or
          a session was started in it. A session counts toward the weekend it
          was started in, however long it stayed open.
        </p>

        <ul className="divide-y divide-brass/20">
          {weekends.map((w) => {
            const items = Array.from(w.itemsByDay.values()).reduce(
              (a, b) => a + b,
              0
            );
            const days = Array.from(w.itemsByDay.entries()).sort(([a], [b]) =>
              a.localeCompare(b)
            );
            const festivalName = w.festival_id
              ? (festivalsById.get(w.festival_id)?.name ?? '(deleted festival)')
              : 'No festival';
            return (
              <li key={`${w.festival_id}|${w.saturday}`} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="font-ui font-medium">
                    Weekend of {fmtDay(parseDay(w.saturday).getTime(), true)}
                    {showFestival && (
                      <span className="font-normal text-walnut/60">
                        {' '}
                        · {festivalName}
                      </span>
                    )}
                  </div>
                  <div className="text-sm tabular-nums text-walnut/70 shrink-0">
                    {items} item{items === 1 ? '' : 's'}
                  </div>
                </div>
                {days.length > 0 ? (
                  <div className="text-xs text-walnut/70 mt-0.5">
                    Sales:{' '}
                    {days
                      .map(
                        ([day, n]) =>
                          `${fmtDay(parseDay(day).getTime())} (${n})`
                      )
                      .join(' · ')}
                  </div>
                ) : (
                  <Flag>
                    No sales — counted only because a session was started
                  </Flag>
                )}
                {w.sessions.length > 0 && (
                  <ul className="text-xs text-walnut/70 mt-1 space-y-0.5">
                    {w.sessions.map((s) => (
                      <li key={s.id}>
                        Session: {fmtDay(s.started_at)} {fmtTime(s.started_at)}
                        {' → '}
                        {s.ended_at === null
                          ? 'never ended'
                          : sameDay(s.started_at, s.ended_at)
                            ? fmtTime(s.ended_at)
                            : `${fmtDay(s.ended_at)} ${fmtTime(s.ended_at)}`}
                        {isMidweek(s.started_at) && (
                          <span className="text-copper">
                            {' '}
                            · started mid-week
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>

        <div className="text-center">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}

function Flag({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-copper mt-0.5">{children}</div>;
}

function fmtDay(ms: number, withYear = false): string {
  return new Date(ms).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: withYear ? 'numeric' : undefined,
  });
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** Tuesday–Thursday: not a festival day, so likely started by mistake. */
function isMidweek(ms: number): boolean {
  const d = new Date(ms).getDay();
  return d >= 2 && d <= 4;
}
