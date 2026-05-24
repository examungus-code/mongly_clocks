import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db,
  type AdjustmentReason,
  type ID,
  type InventoryAdjustment,
} from '../../db/schema';
import { fmtDateTime } from '../../utils/format';
import { Confirm } from '../../components/Confirm';
import { deleteAdjustment } from '../../domain/inventory';
import { deleteTransaction } from '../../domain/transactions';

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
  const lineItems = useLiveQuery(() => db.line_items.toArray());
  const categories = useLiveQuery(() => db.categories.toArray());

  const [reasonFilter, setReasonFilter] = useState<AdjustmentReason | ''>('');
  const [productFilter, setProductFilter] = useState<ID | ''>('');
  const [pendingDelete, setPendingDelete] =
    useState<InventoryAdjustment | null>(null);

  const productName = (id: ID) => products?.find((p) => p.id === id)?.name ?? id;

  // Precompute "Necklaces / Metal / Vintage" for each category so we don't
  // walk parents per render row.
  const categoryPath = useMemo(() => {
    const byId = new Map<ID, { name: string; parent_id: ID | null }>();
    for (const c of categories ?? []) {
      byId.set(c.id, { name: c.name, parent_id: c.parent_id });
    }
    const cache = new Map<ID, string>();
    function pathOf(id: ID | null): string {
      if (!id) return '';
      const hit = cache.get(id);
      if (hit !== undefined) return hit;
      const cat = byId.get(id);
      if (!cat) return '';
      const parentPath = pathOf(cat.parent_id);
      const full = parentPath ? `${parentPath} / ${cat.name}` : cat.name;
      cache.set(id, full);
      return full;
    }
    return (product_id: ID): string => {
      const product = products?.find((p) => p.id === product_id);
      if (!product) return '';
      return pathOf(product.category_id);
    };
  }, [categories, products]);

  // For a sold adjustment, find the matching line item to recover the subtype
  // snapshot stored at sale time. Adjustments don't carry subtype themselves
  // because sold ones are derived from the line item.
  const subtypeForAdjustment = useMemo(() => {
    const map = new Map<ID, string | null>();
    if (!lineItems) return map;
    for (const a of adjustments ?? []) {
      if (a.reason !== 'sold' || !a.transaction_id) continue;
      const line = lineItems.find(
        (l) => l.transaction_id === a.transaction_id && l.product_id === a.product_id
      );
      if (line) map.set(a.id, line.subtype ?? null);
    }
    return map;
  }, [adjustments, lineItems]);

  const filtered = useMemo(() => {
    return (adjustments ?? []).filter((a) => {
      if (reasonFilter && a.reason !== reasonFilter) return false;
      if (productFilter && a.product_id !== productFilter) return false;
      return true;
    });
  }, [adjustments, reasonFilter, productFilter]);

  const isSold = (a: InventoryAdjustment) => a.reason === 'sold';

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
          {filtered.map((a) => {
            const subtype = subtypeForAdjustment.get(a.id);
            return (
              <li
                key={a.id}
                className="p-3 grid grid-cols-[1fr_auto_auto] gap-3 items-center text-sm"
              >
                <div className="min-w-0">
                  {categoryPath(a.product_id) && (
                    <div className="text-[11px] text-walnut/50 truncate">
                      {categoryPath(a.product_id)}
                    </div>
                  )}
                  <div className="font-ui truncate">
                    {productName(a.product_id)}
                    {subtype && (
                      <span className="text-walnut/60"> · {subtype}</span>
                    )}
                  </div>
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
                <button
                  className="text-copper text-xs hover:underline"
                  onClick={() => setPendingDelete(a)}
                  title={
                    isSold(a)
                      ? 'Delete the whole sale and restore inventory'
                      : 'Delete this adjustment and roll back its quantity change'
                  }
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Confirm
        open={!!pendingDelete}
        title={
          pendingDelete && isSold(pendingDelete)
            ? 'Delete this sale?'
            : 'Delete this adjustment?'
        }
        body={
          pendingDelete && isSold(pendingDelete)
            ? "This will erase the entire sale this row was part of (including any other items on the same transaction) and add the quantities back to inventory. Can't be undone."
            : "This will erase the adjustment and reverse its effect on the on-hand quantity. Can't be undone."
        }
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          if (isSold(pendingDelete) && pendingDelete.transaction_id) {
            await deleteTransaction(pendingDelete.transaction_id);
          } else {
            await deleteAdjustment(pendingDelete.id);
          }
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
