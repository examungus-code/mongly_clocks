import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db,
  type AdjustmentReason,
  type ID,
} from '../../db/schema';
import { fmtDateTime } from '../../utils/format';

const REASONS: { value: AdjustmentReason | ''; label: string }[] = [
  { value: '', label: 'All reasons' },
  { value: 'sold', label: 'Sold' },
  { value: 'restocked', label: 'Restocked' },
  { value: 'lost', label: 'Lost' },
  { value: 'broken', label: 'Broken' },
  { value: 'manual_correction', label: 'Manual correction' },
];

export function InventoryLog() {
  const adjustments = useLiveQuery(() =>
    db.adjustments.orderBy('occurred_at').reverse().toArray()
  );
  const products = useLiveQuery(() => db.products.toArray());

  const [reasonFilter, setReasonFilter] = useState<AdjustmentReason | ''>('');
  const [productFilter, setProductFilter] = useState<ID | ''>('');

  const productName = (id: ID) => products?.find((p) => p.id === id)?.name ?? id;

  const filtered = useMemo(() => {
    return (adjustments ?? []).filter((a) => {
      if (reasonFilter && a.reason !== reasonFilter) return false;
      if (productFilter && a.product_id !== productFilter) return false;
      return true;
    });
  }, [adjustments, reasonFilter, productFilter]);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl">Inventory adjustments</h2>

      <div className="card p-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label">Reason</label>
          <select
            className="input"
            value={reasonFilter}
            onChange={(e) =>
              setReasonFilter(e.target.value as AdjustmentReason | '')
            }
          >
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Product</label>
          <select
            className="input"
            value={productFilter}
            onChange={(e) => setProductFilter(e.target.value)}
          >
            <option value="">All products</option>
            {products?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-walnut/60 text-center py-8">No adjustments yet.</p>
      ) : (
        <ul className="card divide-y divide-brass/20">
          {filtered.map((a) => (
            <li
              key={a.id}
              className="p-3 grid grid-cols-[1fr_auto_auto] gap-3 items-center text-sm"
            >
              <div>
                <div className="font-ui">{productName(a.product_id)}</div>
                <div className="text-xs text-walnut/60">
                  {fmtDateTime(a.occurred_at)} · {a.reason}
                  {a.note && ` · ${a.note}`}
                </div>
              </div>
              <span
                className={`font-display text-lg ${
                  a.delta > 0 ? 'text-walnut' : 'text-copper'
                }`}
              >
                {a.delta > 0 ? '+' : ''}
                {a.delta}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
