import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/schema';
import {
  useCart,
  updateCartLine,
  removeCartLine,
  clearCart,
} from '../../hooks/useCart';
import { completeTransaction } from '../../domain/transactions';
import { fmtCurrency } from '../../utils/format';
import { PhotoImg } from '../../components/PhotoImg';

export function Cart() {
  const navigate = useNavigate();
  const cart = useCart();
  const session = useLiveQuery(() => db.session.get('session'));
  const paymentTypes = useLiveQuery(() =>
    db.payment_types.filter((p) => !p.archived).sortBy('sort_order')
  );
  const products = useLiveQuery(() => db.products.toArray());

  const [paymentTypeId, setPaymentTypeId] = useState<string>('');
  const [note, setNote] = useState('');
  const [completing, setCompleting] = useState(false);

  // Default payment to session default
  if (!paymentTypeId && session?.default_payment_type_id) {
    setPaymentTypeId(session.default_payment_type_id);
  }

  function getProduct(id: string) {
    return products?.find((p) => p.id === id);
  }

  async function handleComplete() {
    if (cart.lines.length === 0 || !paymentTypeId) return;
    setCompleting(true);
    try {
      await completeTransaction({
        lines: cart.lines,
        festival_id: session?.festival_id ?? null,
        payment_type_id: paymentTypeId,
        note,
      });
      clearCart();
      navigate('/sell');
    } finally {
      setCompleting(false);
    }
  }

  const total = cart.lines.reduce((s, l) => s + l.unit_price * l.quantity, 0);

  if (cart.lines.length === 0) {
    return (
      <div className="text-center py-12 space-y-4">
        <h2 className="text-2xl">Cart is empty</h2>
        <Link to="/sell" className="btn-primary">
          Back to sell
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-xl mx-auto pb-24">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl">Cart</h2>
        <Link to="/sell" className="btn-ghost text-sm">
          ← Add more
        </Link>
      </div>

      <ul className="space-y-2">
        {cart.lines.map((line, i) => {
          const product = getProduct(line.product_id);
          return (
            <li key={i} className="card p-3 flex gap-3 items-center">
              <PhotoImg
                photo_id={product?.photo_id ?? null}
                alt={line.product_name}
                className="w-14 h-14 object-cover rounded-md flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="font-ui font-medium truncate">
                  {line.product_name}
                  {line.subtype && (
                    <span className="text-xs text-walnut/60 font-normal ml-1">
                      · {line.subtype}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    className="btn-secondary !px-2 !py-1 !min-h-0 text-sm"
                    onClick={() =>
                      updateCartLine(i, {
                        quantity: Math.max(1, line.quantity - 1),
                      })
                    }
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-sm">{line.quantity}</span>
                  <button
                    className="btn-secondary !px-2 !py-1 !min-h-0 text-sm"
                    onClick={() =>
                      updateCartLine(i, { quantity: line.quantity + 1 })
                    }
                  >
                    +
                  </button>
                  <span className="text-xs text-walnut/60">× </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input !min-h-0 !py-1 w-20 text-sm"
                    value={line.unit_price}
                    onChange={(e) =>
                      updateCartLine(i, {
                        unit_price: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                </div>
              </div>
              <div className="text-right">
                <div className="font-display">
                  {fmtCurrency(line.unit_price * line.quantity)}
                </div>
                <button
                  className="text-xs text-copper hover:underline"
                  onClick={() => removeCartLine(i)}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="card p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-lg">Total</span>
          <span className="font-display text-2xl">{fmtCurrency(total)}</span>
        </div>
        <div>
          <label className="label">Payment type</label>
          <select
            className="input"
            value={paymentTypeId}
            onChange={(e) => setPaymentTypeId(e.target.value)}
          >
            <option value="">— Select —</option>
            {paymentTypes?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Note (optional)</label>
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. bundled with earrings"
          />
        </div>
        <div className="flex gap-2 pt-2">
          <button
            className="btn-ghost flex-1"
            onClick={() => {
              if (confirm('Discard cart?')) {
                clearCart();
                navigate('/sell');
              }
            }}
          >
            Discard
          </button>
          <button
            className="btn-primary flex-[2]"
            disabled={completing || !paymentTypeId}
            onClick={handleComplete}
          >
            {completing ? 'Recording…' : 'Complete transaction'}
          </button>
        </div>
      </div>
    </div>
  );
}
