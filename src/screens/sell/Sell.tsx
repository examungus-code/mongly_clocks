// Sell screen — booth optimized. Drill-down navigation through categories
// (like a file system), with text search that overrides the hierarchy by
// showing a flat list of matches across all categories.

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Category, type ID, type Product } from '../../db/schema';
import { PhotoImg } from '../../components/PhotoImg';
import { fmtCurrency } from '../../utils/format';
import { ProductActionSheet } from './ProductActionSheet';
import { useCart } from '../../hooks/useCart';

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

  const [search, setSearch] = useState('');
  const [cwd, setCwd] = useState<ID | null>(null); // null = root
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const cart = useCart();

  // ---- Hierarchical lookups ----
  // Index categories by parent for O(1) child lookup, and build full ancestor
  // paths for breadcrumb + recursive product counts.
  const { childrenByParent, productsByCategory, categoryById, ancestors } =
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

      // Walk from cwd up to root for the breadcrumb.
      const ancestors: Category[] = [];
      let cursor = cwd ? categoryById.get(cwd) ?? null : null;
      while (cursor) {
        ancestors.unshift(cursor);
        cursor = cursor.parent_id ? categoryById.get(cursor.parent_id) ?? null : null;
      }

      return { childrenByParent, productsByCategory, categoryById, ancestors };
    }, [categories, products, cwd]);

  // Count of products contained in this category recursively (for badge).
  function recursiveProductCount(cat_id: ID): number {
    let total = productsByCategory.get(cat_id)?.length ?? 0;
    for (const child of childrenByParent.get(cat_id) ?? []) {
      total += recursiveProductCount(child.id);
    }
    return total;
  }

  // Search bypasses hierarchy entirely.
  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !products) return null;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, search]);

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

  const cartTotal = cart.lines.reduce(
    (s, l) => s + l.quantity * l.unit_price,
    0
  );
  const cartCount = cart.lines.reduce((s, l) => s + l.quantity, 0);

  // What to render in the main area: search results (flat) or the current
  // directory's contents (subcategories + products).
  const inSearchMode = !!searchMatches;
  const currentSubcategories = inSearchMode
    ? []
    : childrenByParent.get(cwd) ?? [];
  const currentProducts = inSearchMode
    ? searchMatches
    : cwd
    ? productsByCategory.get(cwd) ?? []
    : productsByCategory.get(cwd as unknown as ID) ?? [];
  // Note on the last line: products living at the "root" (no category) aren't
  // a thing in this app (products require a category_id), but the lookup is
  // harmless and the empty array result lets us still render a "no products
  // here, pick a category" state cleanly when cwd is null.

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
        <button
          className="btn-ghost text-sm"
          onClick={async () => {
            if (confirm('End session?')) {
              await db.session.update('session', { started_at: null });
              navigate('/');
            }
          }}
        >
          End
        </button>
      </div>

      <input
        type="search"
        placeholder="Search products…"
        className="input mb-3"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* Breadcrumb: only when not searching */}
      {!inSearchMode && (
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
      )}

      {/* Subcategories row — same grid, but folder-styled tiles */}
      {currentSubcategories.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-3">
          {currentSubcategories.map((cat) => (
            <button
              key={cat.id}
              className="tile p-3 text-left flex flex-col gap-1"
              onClick={() => setCwd(cat.id)}
            >
              <div className="aspect-square rounded-md bg-parchment-dark flex items-center justify-center text-5xl text-brass/70">
                ⚙
              </div>
              <div className="mt-1 text-sm font-ui font-medium truncate">
                {cat.name}
              </div>
              <div className="text-xs text-walnut/60">
                {recursiveProductCount(cat.id)} item
                {recursiveProductCount(cat.id) === 1 ? '' : 's'}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Products grid */}
      {currentProducts.length === 0 && currentSubcategories.length === 0 ? (
        <p className="text-walnut/60 text-center py-8">
          {inSearchMode
            ? 'No matches.'
            : products?.length === 0
            ? 'No products yet. Add some in Catalogue.'
            : cwd === null
            ? 'Tap a category above to drill in.'
            : 'Nothing in this category yet.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {currentProducts.map((p) => (
            <button
              key={p.id}
              className="tile p-2 text-left"
              onClick={() => setActiveProduct(p)}
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
              {inSearchMode && categoryById.has(p.category_id) && (
                <div className="text-[10px] text-walnut/50 truncate mt-0.5">
                  in {categoryById.get(p.category_id)!.name}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {cartCount > 0 && (
        <Link
          to="/cart"
          className="fixed bottom-20 right-4 btn-primary shadow-lg z-10"
        >
          Cart · {cartCount} item{cartCount === 1 ? '' : 's'} ·{' '}
          {fmtCurrency(cartTotal)}
        </Link>
      )}

      {activeProduct && (
        <ProductActionSheet
          product={activeProduct}
          onClose={() => setActiveProduct(null)}
        />
      )}
    </div>
  );
}
