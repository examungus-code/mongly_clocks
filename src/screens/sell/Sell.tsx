// Sell screen — booth optimized for speed.
//
// Tap = sale. One tap on a product tile records a single-line transaction
// of quantity 1. The only exception is products that have subtypes but no
// default subtype set — those open a one-tap subtype picker, then sell.
//
// No cart, no search bar, no quantity stepper. This is strictly an inventory
// tracker; there is no currency or payment. Mistakes are corrected via the
// Recent screen (delete the transaction) or via the catalogue editor for
// inventory adjustments.

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Category, type ID, type Product } from '../../db/schema';
import { PhotoImg } from '../../components/PhotoImg';
import { completeTransaction } from '../../domain/transactions';
import { resolveSubtypeConfig } from '../../domain/catalogue';
import { SubtypePicker } from './SubtypePicker';

interface Toast {
  product_name: string;
  expiresAt: number;
}

export function Sell() {
  const navigate = useNavigate();
  const session = useLiveQuery(() => db.session.get('session'));
  const products = useLiveQuery(() =>
    db.products.filter((p) => !p.archived).toArray()
  );
  const categories = useLiveQuery(() => db.categories.toArray());
  const festival = useLiveQuery(
    () => (session?.festival_id ? db.festivals.get(session.festival_id) : undefined),
    [session?.festival_id]
  );

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
      let cursor = cwd ? categoryById.get(cwd) ?? null : null;
      while (cursor) {
        ancestors.unshift(cursor);
        cursor = cursor.parent_id ? categoryById.get(cursor.parent_id) ?? null : null;
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

  // Today's totals — item count + transaction count, no currency.
  const since = session?.started_at ?? 0;
  const todaysTx = useLiveQuery(
    () => db.transactions.where('occurred_at').above(since).toArray(),
    [since]
  );
  const todaysItemCount = useLiveQuery(async () => {
    if (!todaysTx) return 0;
    const ids = todaysTx.map((t) => t.id);
    if (ids.length === 0) return 0;
    const lines = await db.line_items.where('transaction_id').anyOf(ids).toArray();
    return lines.reduce((s, l) => s + l.quantity, 0);
  }, [todaysTx]);

  if (!session?.started_at) {
    return (
      <div className="text-center py-12 space-y-4">
        <h2 className="text-2xl">No active session</h2>
        <p className="text-walnut/70">
          Start a session to pick a festival.
        </p>
        <Link to="/session/start" className="btn-primary">
          Start session
        </Link>
      </div>
    );
  }

  async function sellNow(product: Product, subtype: string | null) {
    try {
      await completeTransaction({
        lines: [
          {
            product_id: product.id,
            product_name: product.name,
            quantity: 1,
            subtype,
          },
        ],
        festival_id: session?.festival_id ?? null,
      });
      showToast(product.name + (subtype ? ` · ${subtype}` : ''));
    } catch (err) {
      console.error('sale failed', err);
      alert(
        `Sale failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  function handleTileTap(product: Product) {
    // Effective subtype config = product's own if defined, else inherited from
    // the closest category ancestor that defines subtypes. When subtypes
    // exist, the operator always picks — there are no defaults.
    const cfg = resolveSubtypeConfig(product, categoryById);
    if (cfg.subtypes.length > 0) {
      setPickingSubtypeFor(product);
      return;
    }
    void sellNow(product, null);
  }

  function showToast(name: string) {
    const expiresAt = Date.now() + 2500;
    setToast({ product_name: name, expiresAt });
    setTimeout(() => {
      setToast((cur) => (cur && cur.expiresAt === expiresAt ? null : cur));
    }, 2500);
  }

  const currentSubcategories = childrenByParent.get(cwd) ?? [];
  const currentProducts = cwd ? productsByCategory.get(cwd) ?? [] : [];

  return (
    <div className="relative pb-24">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-xs uppercase text-brass-dark font-ui">
            Session
          </div>
          <div className="font-display text-lg leading-tight">
            {festival?.name ?? '—'}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase text-brass-dark font-ui">Today</div>
          <div className="font-display text-lg leading-tight">
            {todaysItemCount ?? 0} item
            {todaysItemCount === 1 ? '' : 's'}
          </div>
        </div>
        <Link to="/sell/recent" className="btn-ghost text-sm">
          Recent
        </Link>
        <button
          className="btn-ghost text-sm"
          onClick={async () => {
            if (!confirm('End session?')) return;
            const now = Date.now();
            const startedAt = session?.started_at ?? null;
            if (startedAt) {
              const active = await db.session_records
                .where('started_at')
                .equals(startedAt)
                .first();
              if (active && active.ended_at === null) {
                await db.session_records.update(active.id, {
                  ended_at: now,
                  updated_at: now,
                });
              }
            }
            await db.session.update('session', { started_at: null });
            navigate('/');
          }}
        >
          End
        </button>
      </div>

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
          subtypes={resolveSubtypeConfig(pickingSubtypeFor, categoryById).subtypes}
          onCancel={() => setPickingSubtypeFor(null)}
          onPick={async (subtype) => {
            const p = pickingSubtypeFor;
            setPickingSubtypeFor(null);
            await sellNow(p, subtype);
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
