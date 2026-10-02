// Sell screen — booth optimized for speed.
//
// Tap = sale. One tap on a product tile records a single-line transaction
// of quantity 1. The only exception is products that have subtypes or sizes —
// those open a one-tap picker, then sell.
//
// Every sale is tagged with the festival picked in the menu at the top (see
// hooks/useCurrentFestival.ts). There is no session to start or end; she
// just changes the festival when she moves to another faire.
//
// No cart, no search bar, no quantity stepper. This is strictly an inventory
// tracker; there is no currency or payment. Mistakes are corrected via the
// Recent screen (delete the transaction) or via the catalogue editor for
// inventory adjustments.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Category, type ID, type Product } from '../../db/schema';
import { PhotoImg } from '../../components/PhotoImg';
import { completeTransaction } from '../../domain/transactions';
import { resolveSubtypeConfig } from '../../domain/catalogue';
import { useCurrentFestival } from '../../hooks/useCurrentFestival';
import { startOfToday } from '../../utils/format';
import { SubtypePicker } from './SubtypePicker';

interface Toast {
  product_name: string;
  expiresAt: number;
}

export function Sell() {
  const prefs = useLiveQuery(() => db.prefs.get('prefs'));
  const products = useLiveQuery(() =>
    db.products.filter((p) => !p.archived).toArray()
  );
  const categories = useLiveQuery(() => db.categories.toArray());
  const festival = useCurrentFestival();

  const [cwd, setCwd] = useState<ID | null>(null); // null = root
  const [pickingSubtypeFor, setPickingSubtypeFor] = useState<Product | null>(
    null
  );
  const [toast, setToast] = useState<Toast | null>(null);

  // ---- Hierarchical lookups ----
  const { childrenByParent, productsByCategory, ancestors, categoryById } =
    useMemo(() => {
      const childrenByParent = new Map<ID | null, Category[]>();
      const productsByCategory = new Map<ID, Product[]>();
      const categoryById = new Map<ID, Category>();

      for (const c of categories ?? []) {
        categoryById.set(c.id, c);
        const list = childrenByParent.get(c.parent_id) ?? [];
        list.push(c);
        childrenByParent.set(c.parent_id, list);
      }
      for (const list of childrenByParent.values()) {
        list.sort(
          (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
        );
      }
      for (const p of products ?? []) {
        const list = productsByCategory.get(p.category_id) ?? [];
        list.push(p);
        productsByCategory.set(p.category_id, list);
      }
      for (const list of productsByCategory.values()) {
        list.sort(
          (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
        );
      }

      const ancestors: Category[] = [];
      let cursor = cwd ? (categoryById.get(cwd) ?? null) : null;
      while (cursor) {
        ancestors.unshift(cursor);
        cursor = cursor.parent_id
          ? (categoryById.get(cursor.parent_id) ?? null)
          : null;
      }

      return { childrenByParent, productsByCategory, ancestors, categoryById };
    }, [categories, products, cwd]);

  function recursiveProductCount(cat_id: ID): number {
    let total = productsByCategory.get(cat_id)?.length ?? 0;
    for (const child of childrenByParent.get(cat_id) ?? []) {
      total += recursiveProductCount(child.id);
    }
    return total;
  }

  // Today's totals (since local midnight) — item count, no currency.
  const since = startOfToday();
  const todaysTx = useLiveQuery(
    () => db.transactions.where('occurred_at').aboveOrEqual(since).toArray(),
    [since]
  );
  const todaysItemCount = useLiveQuery(async () => {
    if (!todaysTx) return 0;
    const ids = todaysTx.map((t) => t.id);
    if (ids.length === 0) return 0;
    const lines = await db.line_items
      .where('transaction_id')
      .anyOf(ids)
      .toArray();
    return lines.reduce((s, l) => s + l.quantity, 0);
  }, [todaysTx]);

  async function handleFestivalChange(value: string) {
    if (value === '__new') {
      const name = prompt('New festival name')?.trim();
      if (name) await festival.createAndSelect(name);
      return;
    }
    await festival.select(value || null);
  }

  async function sellNow(
    product: Product,
    subtype: string | null,
    size: string | null
  ) {
    try {
      await completeTransaction({
        lines: [
          {
            product_id: product.id,
            product_name: product.name,
            quantity: 1,
            subtype,
            size,
          },
        ],
        festival_id: festival.currentId,
      });
      const tag = (subtype ? ` · ${subtype}` : '') + (size ? ` · ${size}` : '');
      showToast(product.name + tag);
      // Optional jump-to-root after a sale, controlled by a settings flag.
      if (prefs?.return_to_top_after_sale) {
        setCwd(null);
      }
    } catch (err) {
      console.error('sale failed', err);
      alert(`Sale failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function handleTileTap(product: Product) {
    // Effective subtype config = product's own if defined, else inherited from
    // the closest category ancestor that defines subtypes. Sizes are
    // product-only (no inheritance). If either dimension exists, open the
    // variant picker.
    const cfg = resolveSubtypeConfig(product, categoryById);
    const hasSizes = (product.sizes ?? []).length > 0;
    if (cfg.subtypes.length > 0 || hasSizes) {
      setPickingSubtypeFor(product);
      return;
    }
    void sellNow(product, null, null);
  }

  function showToast(name: string) {
    const expiresAt = Date.now() + 2500;
    setToast({ product_name: name, expiresAt });
    setTimeout(() => {
      setToast((cur) => (cur && cur.expiresAt === expiresAt ? null : cur));
    }, 2500);
  }

  const currentSubcategories = childrenByParent.get(cwd) ?? [];
  const currentProducts = cwd ? (productsByCategory.get(cwd) ?? []) : [];

  return (
    <div className="relative pb-24">
      <div className="flex items-end justify-between gap-3 mb-1">
        <label className="flex-1 min-w-0">
          <span className="block text-xs uppercase text-brass-dark font-ui">
            Selling at
          </span>
          <select
            className="input !min-h-0 !py-1.5 font-display"
            value={festival.currentId ?? ''}
            onChange={(e) => void handleFestivalChange(e.target.value)}
          >
            <option value="">No festival</option>
            {festival.festivals
              ?.filter((f) => !f.archived || f.id === festival.currentId)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            <option value="__new">+ New festival…</option>
          </select>
        </label>
        <div className="text-right shrink-0">
          <div className="text-xs uppercase text-brass-dark font-ui">Today</div>
          <div className="font-display text-lg leading-tight">
            {todaysItemCount ?? 0} item
            {todaysItemCount === 1 ? '' : 's'}
          </div>
        </div>
        <Link to="/sell/recent" className="btn-ghost text-sm shrink-0">
          Recent
        </Link>
      </div>
      {festival.wasReset ? (
        <p className="text-xs text-copper mb-3">
          The festival you had picked is no longer in the festival list (a Pull
          from Drive may have replaced it). Pick where you're selling above.
        </p>
      ) : festival.currentId === null ? (
        <p className="text-xs text-walnut/60 mb-3">
          Sales won't be tagged with a festival. Pick one above if you're at a
          faire.
        </p>
      ) : (
        <div className="mb-3" />
      )}

      <nav className="flex flex-wrap items-center gap-1 mb-3 text-sm">
        <button
          onClick={() => setCwd(null)}
          className={`px-2 py-1 rounded font-ui ${
            cwd === null
              ? 'text-walnut-dark font-medium'
              : 'text-walnut/70 hover:text-walnut'
          }`}
        >
          ⌂ All
        </button>
        {ancestors.map((a, i) => (
          <span key={a.id} className="flex items-center gap-1">
            <span className="text-walnut/40">/</span>
            <button
              onClick={() => setCwd(a.id)}
              className={`px-2 py-1 rounded font-ui ${
                i === ancestors.length - 1
                  ? 'text-walnut-dark font-medium'
                  : 'text-walnut/70 hover:text-walnut'
              }`}
            >
              {a.name}
            </button>
          </span>
        ))}
      </nav>

      {currentSubcategories.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
          {currentSubcategories.map((cat) => {
            const count = recursiveProductCount(cat.id);
            return (
              <button
                key={cat.id}
                onClick={() => setCwd(cat.id)}
                className="tile px-4 py-6 min-h-[120px] flex flex-col items-center justify-center text-center active:scale-95 transition-transform"
              >
                <span className="font-display text-xl sm:text-2xl text-walnut-dark leading-tight">
                  {cat.name}
                </span>
                <span className="text-xs text-walnut/60 mt-1">
                  {count} item{count === 1 ? '' : 's'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {currentProducts.length === 0 && currentSubcategories.length === 0 ? (
        <p className="text-walnut/60 text-center py-8">
          {products?.length === 0
            ? 'No products yet. Add some in Catalogue.'
            : cwd === null
              ? 'Tap a category above to drill in.'
              : 'Nothing in this category yet.'}
        </p>
      ) : (
        currentProducts.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {currentProducts.map((p) => (
              <button
                key={p.id}
                className="tile p-2 text-left active:scale-95 transition-transform"
                onClick={() => handleTileTap(p)}
              >
                <PhotoImg
                  photo_id={p.photo_id}
                  alt={p.name}
                  className="w-full aspect-square object-cover rounded-md"
                />
                <div className="mt-2 text-sm font-ui font-medium truncate">
                  {p.name}
                </div>
                <div className="text-xs text-walnut/60 text-right">
                  qty {p.quantity_on_hand}
                </div>
                {(() => {
                  const cfg = resolveSubtypeConfig(p, categoryById);
                  if (cfg.subtypes.length === 0) return null;
                  return (
                    <div className="text-[10px] text-walnut/50 truncate mt-0.5">
                      ↳ pick subtype
                    </div>
                  );
                })()}
              </button>
            ))}
          </div>
        )
      )}

      {pickingSubtypeFor && (
        <SubtypePicker
          product={pickingSubtypeFor}
          subtypes={
            resolveSubtypeConfig(pickingSubtypeFor, categoryById).subtypes
          }
          sizes={pickingSubtypeFor.sizes ?? []}
          onCancel={() => setPickingSubtypeFor(null)}
          onPick={async (subtype, size) => {
            const p = pickingSubtypeFor;
            setPickingSubtypeFor(null);
            await sellNow(p, subtype, size);
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-walnut text-parchment-light px-4 py-2 rounded-lg shadow-lg z-20 text-sm font-ui"
        >
          ✓ Sold: {toast.product_name}
        </div>
      )}
    </div>
  );
}
