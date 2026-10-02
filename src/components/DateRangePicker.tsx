// Calendar popup for picking a date range. Tap a start day, then an end day.
// Tapping the same day twice (a double tap) picks just that one day. Days
// with recorded sales get a dot so festival weekends are easy to find.

import { useEffect, useRef, useState } from 'react';
import { formatDay, parseDay } from '../domain/sales-filter';

interface Props {
  /** Current range, used to open on the right month and show the selection. */
  initial: { start: string; end: string } | null;
  /** 'YYYY-MM-DD' days to mark with a dot (days that had sales). */
  markedDays: Set<string>;
  onApply: (start: string, end: string) => void;
  onCancel: () => void;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function DateRangePicker({
  initial,
  markedDays,
  onApply,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  // No close() on cleanup: the dialog leaves the DOM on unmount anyway, and a
  // cleanup close() fires a 'close' event that would cancel the picker when
  // React re-runs effects (StrictMode in dev).
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  // Open on the selected range, else the most recent month with sales, else today.
  const [month, setMonth] = useState(() => {
    const latestMarked = Array.from(markedDays).sort().pop();
    const anchor = initial
      ? parseDay(initial.start)
      : latestMarked
        ? parseDay(latestMarked)
        : new Date();
    return { year: anchor.getFullYear(), month0: anchor.getMonth() };
  });
  // First tap of a new selection; null when no selection is in progress.
  const [pendingStart, setPendingStart] = useState<string | null>(null);

  function shiftMonth(delta: number) {
    setMonth(({ year, month0 }) => {
      const d = new Date(year, month0 + delta, 1);
      return { year: d.getFullYear(), month0: d.getMonth() };
    });
  }

  function tapDay(day: string) {
    if (pendingStart === null) {
      setPendingStart(day);
      return;
    }
    const [start, end] =
      pendingStart <= day ? [pendingStart, day] : [day, pendingStart];
    onApply(start, end);
  }

  const firstWeekday = new Date(month.year, month.month0, 1).getDay();
  const daysInMonth = new Date(month.year, month.month0 + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      formatDay(month.year, month.month0, i + 1)
    ),
  ];

  const shown = pendingStart
    ? { start: pendingStart, end: pendingStart }
    : initial;
  const monthLabel = new Date(month.year, month.month0, 1).toLocaleDateString(
    'en-US',
    {
      month: 'long',
      year: 'numeric',
    }
  );

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      className="rounded-lg p-0 bg-white text-walnut border border-brass/40 shadow-xl backdrop:bg-black/50 w-[min(380px,calc(100vw-2rem))]"
    >
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="btn-ghost !px-3"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
          >
            ‹
          </button>
          <div className="font-display text-lg">{monthLabel}</div>
          <button
            type="button"
            className="btn-ghost !px-3"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
          >
            ›
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((w, i) => (
            <div key={i} className="text-xs text-walnut/50 font-ui">
              {w}
            </div>
          ))}
          {cells.map((day, i) => {
            if (!day) return <div key={`blank-${i}`} />;
            const isEndpoint =
              shown && (day === shown.start || day === shown.end);
            const inRange = shown && day > shown.start && day < shown.end;
            return (
              <button
                key={day}
                type="button"
                onClick={() => tapDay(day)}
                className={`relative h-11 rounded-md font-ui text-sm touch-manipulation ${
                  isEndpoint
                    ? 'bg-brass text-walnut font-semibold'
                    : inRange
                      ? 'bg-brass-soft'
                      : 'hover:bg-brass-tint'
                }`}
              >
                {Number(day.slice(8))}
                {markedDays.has(day) && (
                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-walnut/60" />
                )}
              </button>
            );
          })}
        </div>

        <p className="text-xs text-walnut/60 text-center">
          {pendingStart
            ? 'Now tap the last day — or tap the same day again for just that day.'
            : 'Tap the first day, then the last day. Double-tap a day for just that day. Dots mark days with sales.'}
        </p>

        <div className="text-center">
          <button
            type="button"
            className="text-walnut/60 text-sm hover:underline"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
