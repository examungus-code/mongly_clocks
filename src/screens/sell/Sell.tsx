// Sell screen — booth optimized for speed.
//
// Tap = sale. One tap on a product tile creates a single-line transaction with
// quantity 1 at list price, paid via the session's default payment type. The
// only exception is products that have subtypes but no default subtype set —
// those open a one-tap subtype picker, then sell.
//
// No cart, no search bar, no quantity stepper, no price override at sale time.
// Mistakes are corrected via the Recent screen (delete the transaction) or
// via the catalogue editor for inventory adjustments.

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Category, type ID, type Product } from '../../db/schema';
import { PhotoImg } from '../../components/PhotoImg';
import { fmtCurrency } from '../../utils/format';
import { completeTransaction } from '../../domain/transactions';
import { SubtypePicker } from './SubtypePicker';

interface Toast {
  product_name: string;
  amount: number;
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

  // ---- Hierarchical lookups (same as before) ----
  const { childrenByParent, productsByCategory, ancestors } =
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

      return { childrenByParent, productsByCategory, ancestors };
    }, [categories, products, cwd]);

  function recursiveProductCount(cat_id: ID): number {
    let total = productsByCategory.get(cat_id)?.length ?? 0;
    for (const child of childrenByParent.get(cat_id) ?? []) {
      total += recursiveProductCount(child.id);
    }
    return total;
  }

  // Today's totals
  const since = session?.started_at ?? 0;
  const todaysTx = useLiveQuery(
    () => db.transactions.where('occurred_at').above(since).toArray(),
    [since]
  );
  const todayRevenue = (todaysTx ?? []).reduce((s, t) => s + t.total, 0);

  if (!session?.started_at) {
    return (
      <div className="text-center py-12 space-y-4">
        <h2 className="text-2xl">No active session</h2>
        <p className="text-walnut/70">
          Start a session to pick a festival and default payment type.
        </p>
        <Link to="/session/start" className="btn-primary">
          Start session
        </Link>
      </div>
    );
  }

  async function sellNow(product: Product, subtype: string | null) {
    if (!session?.default_payment_type_id) {
      alert('No payment type set on session');
      return;
    }
    await completeTransaction({
      lines: [
        {
          product_id: product.id,
          product_name: product.name,
          quantity: 1,
          unit_price: product.list_price,
          subtype,
        },
      ],
      festival_id: session.festival_id,
      payment_type_id: session.default_payment_type_id,
    });
    showToast(product.name + (subtype ? ` · ${subtype}` : ''), product.list_price);
  }

  function handleTileTap(product: Product) {
    const subtypes = product.subtypes ?? [];
    const hasSubtypes = subtypes.length > 0;
    const def = product.default_subtype ?? null;
    if (hasSubtypes && !def) {
      // Operator must pick — open the picker, sale completes on selection.
      setPickingSubtypeFor(product);
      return;
    }
    void sellNow(product, hasSubtypes ? def : null);
  }

  function showToast(name: string, amount: number) {
    const expiresAt = Date.now() + 2500;
    setToast({ product_name: name, amount, expiresAt });
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
            {fmtCurrency(todayRevenue)}
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
            // Close the matching SessionRecord (the one currently active).
            // Match by started_at since that's the singleton's only handle
            // back to the record.
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
                <div className="flex justify-between text-xs text-walnut/60">
                  <span>{fmtCurrency(p.list_price)}</span>
                  <span>qty {p.quantity_on_hand}</span>
                </div>
                {(p.subtypes ?? []).length > 0 && (
                  <div className="text-[10px] text-walnut/50 truncate mt-0.5">
                    {p.default_subtype
                      ? `→ ${p.default_subtype}`
                      : '↳ pick subtype'}
                  </div>
                )}
              </button>
            ))}
          </div>
        )
      )}

      {pickingSubtypeFor && (
        <SubtypePicker
          product={pickingSubtypeFor}
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
          ✓ Sold: {toast.product_name} · {fmtCurrency(toast.amount)}
        </div>
      )}
    </div>
  );
}
