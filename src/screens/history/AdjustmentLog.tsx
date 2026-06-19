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
import {
  changeLineItemSubtype,
  deleteTransaction,
} from '../../domain/transactions';
import { resolveSubtypeConfig } from '../../domain/catalogue';
import { useEffect, useRef } from 'react';

const REASONS: { value: AdjustmentReason | ''; label: string }[] = [
  { value: '', label: 'All reasons' },
  { value: 'sold', label: 'Sold' },
  { value: 'restocked', label: 'Restocked' },
  { value: 'lost', label: 'Lost' },
  { value: 'broken', label: 'Broken' },
  { value: 'manual_correction', label: 'Manual correction' },
];

export function AdjustmentLog() {
  // 'sold_component' adjustments are intentionally hidden from this view —
  // they're the auto-decrement of a linked component product (e.g. a gold
  // chain consumed by a necklace sale). They still affect quantities and
  // sync to Drive; they just don't deserve their own line here because the
  // parent sale row already tells the story via its subtype suffix.
  const adjustments = useLiveQuery(() =>
    db.adjustments
      .orderBy('occurred_at')
      .reverse()
      .filter((a) => a.reason !== 'sold_component')
      .toArray()
  );
  const products = useLiveQuery(() => db.products.toArray());
  const lineItems = useLiveQuery(() => db.line_items.toArray());
  const categories = useLiveQuery(() => db.categories.toArray());

  const [reasonFilter, setReasonFilter] = useState<AdjustmentReason | ''>('');
  const [productFilter, setProductFilter] = useState<ID | ''>('');
  const [pendingDelete, setPendingDelete] =
    useState<InventoryAdjustment | null>(null);
  const [subtypeEdit, setSubtypeEdit] = useState<{
    line_item_id: ID;
    product_id: ID;
    current: string | null;
  } | null>(null);

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
  // because sold ones are derived from the line item. We also record the
  // line item id so the "change subtype" affordance knows what to update.
  const lineForAdjustment = useMemo(() => {
    const map = new Map<ID, ID>();
    if (!lineItems) return map;
    for (const a of adjustments ?? []) {
      if (a.reason !== 'sold' || !a.transaction_id) continue;
      // Prefer explicit line_item_id; fall back to (tx_id, product_id) match
      // for adjustments written before that field existed.
      const line = a.line_item_id
        ? lineItems.find((l) => l.id === a.line_item_id)
        : lineItems.find(
            (l) =>
              l.transaction_id === a.transaction_id &&
              l.product_id === a.product_id
          );
      if (line) map.set(a.id, line.id);
    }
    return map;
  }, [adjustments, lineItems]);

  function subtypeForAdj(a_id: ID): string | null {
    const lineId = lineForAdjustment.get(a_id);
    if (!lineId) return null;
    const line = lineItems?.find((l) => l.id === lineId);
    return line?.subtype ?? null;
  }

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
      <h2 className="text-2xl">History</h2>

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
            const subtype = subtypeForAdj(a.id);
            const lineId = lineForAdjustment.get(a.id);
            const product = products?.find((p) => p.id === a.product_id);
            const effectiveSubtypes =
              product && categories
                ? resolveSubtypeConfig(
                    product,
                    new Map(categories.map((c) => [c.id, c]))
                  ).subtypes
                : [];
            const canChangeSubtype =
              isSold(a) && lineId && effectiveSubtypes.length > 0;
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
                    {subtype || canChangeSubtype ? (
                      canChangeSubtype ? (
                        <button
                          className="text-walnut/60 hover:text-walnut hover:underline ml-1"
                          onClick={() =>
                            setSubtypeEdit({
                              line_item_id: lineId!,
                              product_id: a.product_id,
                              current: subtype,
                            })
                          }
                          title="Change subtype"
                        >
                          · {subtype ?? '(set subtype)'}
                        </button>
                      ) : (
                        subtype && <span className="text-walnut/60"> · {subtype}</span>
                      )
                    ) : null}
                    {a.size && (
                      <span className="text-walnut/60"> · size {a.size}</span>
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

      {subtypeEdit && (
        <SubtypeChangeDialog
          line_item_id={subtypeEdit.line_item_id}
          product_id={subtypeEdit.product_id}
          current={subtypeEdit.current}
          products={products ?? []}
          categories={categories ?? []}
          onClose={() => setSubtypeEdit(null)}
        />
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

function SubtypeChangeDialog({
  line_item_id,
  product_id,
  current,
  products,
  categories,
  onClose,
}: {
  line_item_id: ID;
  product_id: ID;
  current: string | null;
  products: {
    id: ID;
    name: string;
    category_id: ID;
    subtypes?: string[];
    default_subtype?: string | null;
    subtype_links?: Record<string, ID>;
  }[];
  categories: { id: ID; parent_id: ID | null; subtypes?: string[]; default_subtype?: string | null; subtype_links?: Record<string, ID> }[];
  onClose: () => void;
}) {
  const product = products.find((p) => p.id === product_id);
  // Resolve the effective subtype list — may come from this product or one of
  // its category ancestors.
  const subtypes = product
    ? resolveSubtypeConfig(
        product as Parameters<typeof resolveSubtypeConfig>[0],
        new Map(
          categories.map((c) => [
            c.id,
            c as Parameters<typeof resolveSubtypeConfig>[1] extends Map<ID, infer V>
              ? V
              : never,
          ])
        )
      ).subtypes
    : [];
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);

  async function pick(s: string | null) {
    await changeLineItemSubtype(line_item_id, s);
    onClose();
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="rounded-lg p-0 bg-parchment-light text-walnut border border-brass/40 shadow-xl backdrop:bg-walnut-dark/60 w-[min(420px,calc(100vw-2rem))]"
    >
      <div className="p-5 space-y-3">
        <h3 className="font-display text-lg">
          Change subtype · {product?.name ?? ''}
        </h3>
        <p className="text-xs text-walnut/60">
          Inventory of linked components will be adjusted automatically.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {subtypes.map((s) => (
            <button
              key={s}
              className={`px-3 py-3 rounded-md border font-ui text-sm min-h-[44px] ${
                current === s
                  ? 'bg-brass-dark text-parchment-light border-brass-dark'
                  : 'bg-parchment-light text-walnut border-walnut/30 hover:bg-parchment-dark'
              }`}
              onClick={() => pick(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          className="block w-full text-sm text-walnut/60 hover:underline pt-1"
          onClick={() => pick(null)}
        >
          Clear subtype
        </button>
        <div className="text-center pt-1">
          <button
            className="text-walnut/60 text-sm hover:underline"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
