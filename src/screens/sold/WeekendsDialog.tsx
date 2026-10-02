// Lists the weekends the Data page's per-weekend average divides by, with the
// days that had sales. Each day's sales can be moved to another festival, for
// fixing sales recorded with the wrong festival picked (or tagged with a
// festival that no longer exists).

import { useEffect, useRef, useState } from 'react';
import type { Festival, ID } from '../../db/schema';
import { parseDay, type WorkedWeekend } from '../../domain/sales-filter';
import { moveDaySalesToFestival } from '../../domain/transactions';

interface Props {
  weekends: WorkedWeekend[];
  /** All festivals, sorted by name. */
  festivals: Festival[];
  /** Show each weekend's festival (when the page isn't filtered to one). */
  showFestival: boolean;
  onClose: () => void;
}

export function WeekendsDialog({
  weekends,
  festivals,
  showFestival,
  onClose,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  // `${festival_id}|${day}` of the day whose "Change festival" menu is open.
  const [moving, setMoving] = useState<string | null>(null);

  const festivalName = (id: ID | null) =>
    id
      ? (festivals.find((f) => f.id === id)?.name ?? '(deleted festival)')
      : 'No festival';

  async function moveDay(
    day: string,
    from: ID | null,
    to: ID | null,
    sales: number,
    items: number
  ) {
    setMoving(null);
    const what = `${sales} sale${sales === 1 ? '' : 's'} (${items} item${items === 1 ? '' : 's'})`;
    if (
      !confirm(
        `Move ${what} on ${fmtDay(parseDay(day).getTime(), true)} from ${festivalName(from)} to ${festivalName(to)}? Quantities and inventory don't change.`
      )
    ) {
      return;
    }
    try {
      await moveDaySalesToFestival(day, from, to);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

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
          The per-weekend averages divide by this many weekends: every weekend
          (Friday–Monday around a Saturday) with at least one sale. A weekend
          with booths at more than one festival counts once. If a day's sales
          were recorded under the wrong festival, use Change festival to move
          them.
        </p>

        <ul className="divide-y divide-brass/20">
          {weekends.map((w) => {
            const items = w.days.reduce((sum, d) => sum + d.items, 0);
            const festivalCount = new Set(w.days.map((d) => d.festival_id))
              .size;
            return (
              <li key={w.saturday} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="font-ui font-medium">
                    Weekend of {fmtDay(parseDay(w.saturday).getTime(), true)}
                  </div>
                  <div className="text-sm tabular-nums text-walnut/70 shrink-0">
                    {items} item{items === 1 ? '' : 's'}
                  </div>
                </div>
                <ul className="text-xs text-walnut/70 mt-1 space-y-1">
                  {w.days.map(
                    ({ day, festival_id, items: dayItems, sales }) => {
                      const key = `${festival_id}|${day}`;
                      const unknown =
                        festival_id !== null &&
                        !festivals.some((f) => f.id === festival_id);
                      return (
                        <li
                          key={key}
                          className="flex items-center justify-between gap-3"
                        >
                          <span>
                            {fmtDay(parseDay(day).getTime())}
                            {(showFestival || festivalCount > 1) && (
                              <span className={unknown ? 'text-copper' : ''}>
                                {' '}
                                · {festivalName(festival_id)}
                              </span>
                            )}
                            : {dayItems} item
                            {dayItems === 1 ? '' : 's'}
                          </span>
                          {moving === key ? (
                            <span className="flex items-center gap-1 shrink-0">
                              <select
                                className="input !min-h-0 !py-1 !w-auto text-xs"
                                autoFocus
                                value=""
                                onChange={(e) =>
                                  void moveDay(
                                    day,
                                    festival_id,
                                    e.target.value === '__none'
                                      ? null
                                      : e.target.value,
                                    sales,
                                    dayItems
                                  )
                                }
                              >
                                <option value="" disabled>
                                  Move to…
                                </option>
                                {festivals
                                  .filter((f) => f.id !== festival_id)
                                  .map((f) => (
                                    <option key={f.id} value={f.id}>
                                      {f.name}
                                    </option>
                                  ))}
                                {festival_id !== null && (
                                  <option value="__none">No festival</option>
                                )}
                              </select>
                              <button
                                type="button"
                                className="text-walnut/60 hover:text-walnut px-1"
                                onClick={() => setMoving(null)}
                                aria-label="Cancel"
                              >
                                ✕
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="text-walnut/60 hover:text-walnut hover:underline shrink-0"
                              onClick={() => setMoving(key)}
                            >
                              Change festival
                            </button>
                          )}
                        </li>
                      );
                    }
                  )}
                </ul>
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

function fmtDay(ms: number, withYear = false): string {
  return new Date(ms).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: withYear ? 'numeric' : undefined,
  });
}
