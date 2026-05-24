// Sell screen — booth optimized. Photo-tile grid, text search, tap product for
// action sheet.

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Product } from '../../db/schema';
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
  const festival = useLiveQuery(
    () => (session?.festival_id ? db.festivals.get(session.festival_id) : undefined),
    [session?.festival_id]
  );

  const [search, setSearch] = useState('');
  const [activeProduct, setActiveProduct] = useState<Product | null>(null);
  const cart = useCart();

  const filtered = useMemo(() => {
    if (!products) return [];
    const q = search.trim().toLowerCase();
    if (!q) return products;
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

      {filtered.length === 0 ? (
        <p className="text-walnut/60 text-center py-8">
          {products?.length === 0
            ? 'No products yet. Add some in Catalogue.'
            : 'No matches.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((p) => (
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
