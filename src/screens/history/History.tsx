import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ID } from '../../db/schema';
import { fmtDateTime } from '../../utils/format';
import { downloadCsv, toCsv } from '../../utils/csv-export';

export function History() {
  const transactions = useLiveQuery(() =>
    db.transactions.orderBy('occurred_at').reverse().toArray()
  );
  const lineItems = useLiveQuery(() => db.line_items.toArray());
  const products = useLiveQuery(() => db.products.toArray());
  const festivals = useLiveQuery(() => db.festivals.toArray());

  const [festivalFilter, setFestivalFilter] = useState<string>('');
  const [expanded, setExpanded] = useState<ID | null>(null);

  const productName = (id: ID) => products?.find((p) => p.id === id)?.name ?? id;
  const festivalName = (id: ID | null) =>
    id ? festivals?.find((f) => f.id === id)?.name ?? '—' : '—';

  const filtered = useMemo(() => {
    return (transactions ?? []).filter((t) => {
      if (festivalFilter && t.festival_id !== festivalFilter) return false;
      return true;
    });
  }, [transactions, festivalFilter]);

  const linesByTx = useMemo(() => {
    const map = new Map<ID, typeof lineItems>();
    for (const l of lineItems ?? []) {
      if (!map.has(l.transaction_id)) map.set(l.transaction_id, []);
      map.get(l.transaction_id)!.push(l);
    }
    return map;
  }, [lineItems]);

  function exportCsv() {
    const rows: Record<string, unknown>[] = [];
    for (const tx of filtered) {
      const lines = linesByTx.get(tx.id) ?? [];
      for (const line of lines) {
        rows.push({
          transaction_id: tx.id,
          occurred_at: new Date(tx.occurred_at).toISOString(),
          festival: festivalName(tx.festival_id),
          product: productName(line.product_id),
          subtype: line.subtype ?? '',
          quantity: line.quantity,
          note: tx.note,
        });
      }
    }
    const csv = toCsv(rows, [
      'transaction_id',
      'occurred_at',
      'festival',
      'product',
      'subtype',
      'quantity',
      'note',
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`clockwork-history-${stamp}.csv`, csv);
  }

  const totalCount = filtered.length;
  const totalItems = filtered.reduce(
    (s, tx) =>
      s +
      (linesByTx.get(tx.id) ?? []).reduce((acc, l) => acc + l.quantity, 0),
    0
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl">History</h2>
        <button className="btn-primary" onClick={exportCsv} disabled={filtered.length === 0}>
          Export CSV
        </button>
      </div>

      <div className="card p-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label">Festival</label>
          <select
            className="input"
            value={festivalFilter}
            onChange={(e) => setFestivalFilter(e.target.value)}
          >
            <option value="">All</option>
            {festivals?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="self-end text-right text-sm">
          <span className="text-walnut/60">
            {totalCount} sale{totalCount === 1 ? '' : 's'} ·{' '}
          </span>
          <strong className="font-display text-base">
            {totalItems} item{totalItems === 1 ? '' : 's'}
          </strong>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-walnut/60 text-center py-8">No transactions match.</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((tx) => {
            const lines = linesByTx.get(tx.id) ?? [];
            const qty = lines.reduce((s, l) => s + l.quantity, 0);
            return (
              <li key={tx.id} className="card">
                <button
                  className="w-full text-left p-3 grid grid-cols-[1fr_auto_auto] gap-3 items-center hover:bg-parchment-dark/40"
                  onClick={() => setExpanded(expanded === tx.id ? null : tx.id)}
                >
                  <span className="text-sm">{fmtDateTime(tx.occurred_at)}</span>
                  <span className="text-sm text-walnut/70 truncate hidden sm:inline">
                    {festivalName(tx.festival_id)}
                  </span>
                  <span className="font-display text-right">
                    {qty} item{qty === 1 ? '' : 's'}
                  </span>
                </button>
                {expanded === tx.id && (
                  <div className="border-t border-brass/30 p-3 text-sm space-y-1">
                    {lines.map((l) => (
                      <div key={l.id}>
                        {l.quantity} × {productName(l.product_id)}
                        {l.subtype && (
                          <span className="text-walnut/60"> · {l.subtype}</span>
                        )}
                      </div>
                    ))}
                    {tx.note && (
                      <div className="text-walnut/60 italic pt-1">
                        “{tx.note}”
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
