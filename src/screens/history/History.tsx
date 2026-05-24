import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ID } from '../../db/schema';
import { fmtCurrency, fmtDateTime } from '../../utils/format';
import { downloadCsv, toCsv } from '../../utils/csv-export';

export function History() {
  const transactions = useLiveQuery(() =>
    db.transactions.orderBy('occurred_at').reverse().toArray()
  );
  const lineItems = useLiveQuery(() => db.line_items.toArray());
  const products = useLiveQuery(() => db.products.toArray());
  const festivals = useLiveQuery(() => db.festivals.toArray());
  const paymentTypes = useLiveQuery(() => db.payment_types.toArray());

  const [festivalFilter, setFestivalFilter] = useState<string>('');
  const [paymentFilter, setPaymentFilter] = useState<string>('');
  const [expanded, setExpanded] = useState<ID | null>(null);

  const productName = (id: ID) => products?.find((p) => p.id === id)?.name ?? id;
  const festivalName = (id: ID | null) =>
    id ? festivals?.find((f) => f.id === id)?.name ?? '—' : '—';
  const paymentName = (id: ID) =>
    paymentTypes?.find((p) => p.id === id)?.name ?? '—';

  const filtered = useMemo(() => {
    return (transactions ?? []).filter((t) => {
      if (festivalFilter && t.festival_id !== festivalFilter) return false;
      if (paymentFilter && t.payment_type_id !== paymentFilter) return false;
      return true;
    });
  }, [transactions, festivalFilter, paymentFilter]);

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
          payment_type: paymentName(tx.payment_type_id),
          product: productName(line.product_id),
          quantity: line.quantity,
          unit_price: line.unit_price.toFixed(2),
          line_total: line.line_total.toFixed(2),
          transaction_total: tx.total.toFixed(2),
          note: tx.note,
        });
      }
    }
    const csv = toCsv(rows, [
      'transaction_id',
      'occurred_at',
      'festival',
      'payment_type',
      'product',
      'quantity',
      'unit_price',
      'line_total',
      'transaction_total',
      'note',
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`clockwork-history-${stamp}.csv`, csv);
  }

  const totalRevenue = filtered.reduce((s, t) => s + t.total, 0);
  const totalCount = filtered.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl">History</h2>
        <button className="btn-primary" onClick={exportCsv} disabled={filtered.length === 0}>
          Export CSV
        </button>
      </div>

      <div className="card p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
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
        <div>
          <label className="label">Payment</label>
          <select
            className="input"
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
          >
            <option value="">All</option>
            {paymentTypes?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 sm:col-span-2 self-end text-right text-sm">
          <span className="text-walnut/60">{totalCount} transactions · </span>
          <strong className="font-display text-base">
            {fmtCurrency(totalRevenue)}
          </strong>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-walnut/60 text-center py-8">No transactions match.</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((tx) => (
            <li key={tx.id} className="card">
              <button
                className="w-full text-left p-3 grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_120px_100px_100px] gap-3 items-center hover:bg-parchment-dark/40"
                onClick={() => setExpanded(expanded === tx.id ? null : tx.id)}
              >
                <span className="text-sm">{fmtDateTime(tx.occurred_at)}</span>
                <span className="text-sm text-walnut/70 truncate hidden sm:inline">
                  {festivalName(tx.festival_id)}
                </span>
                <span className="text-sm text-walnut/70">
                  {paymentName(tx.payment_type_id)}
                </span>
                <span className="font-display text-right">
                  {fmtCurrency(tx.total)}
                </span>
              </button>
              {expanded === tx.id && (
                <div className="border-t border-brass/30 p-3 text-sm space-y-1">
                  {(linesByTx.get(tx.id) ?? []).map((l) => (
                    <div key={l.id} className="flex justify-between">
                      <span>
                        {l.quantity} × {productName(l.product_id)}
                      </span>
                      <span>{fmtCurrency(l.line_total)}</span>
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
          ))}
        </ul>
      )}
    </div>
  );
}
