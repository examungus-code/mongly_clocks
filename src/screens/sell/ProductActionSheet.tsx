import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Product } from '../../db/schema';
import { PhotoImg } from '../../components/PhotoImg';
import { fmtCurrency } from '../../utils/format';
import { addToCart } from '../../hooks/useCart';
import { completeTransaction } from '../../domain/transactions';
import { recordAdjustment } from '../../domain/inventory';

interface Props {
  product: Product;
  onClose: () => void;
}

export function ProductActionSheet({ product, onClose }: Props) {
  const session = useLiveQuery(() => db.session.get('session'));
  const ref = useRef<HTMLDialogElement>(null);
  const [qty, setQty] = useState(1);
  const [priceOverride, setPriceOverride] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);

  const unitPrice = priceOverride
    ? parseFloat(priceOverride) || product.list_price
    : product.list_price;

  function handleAddToCart() {
    addToCart({
      product_id: product.id,
      product_name: product.name,
      quantity: qty,
      unit_price: unitPrice,
    });
    onClose();
  }

  async function handleSoldImmediate() {
    if (!session?.default_payment_type_id) {
      alert('No payment type set on session');
      return;
    }
    await completeTransaction({
      lines: [
        {
          product_id: product.id,
          product_name: product.name,
          quantity: qty,
          unit_price: unitPrice,
        },
      ],
      festival_id: session.festival_id,
      payment_type_id: session.default_payment_type_id,
    });
    onClose();
  }

  async function handleLost(reason: 'lost' | 'broken') {
    await recordAdjustment({
      product_id: product.id,
      delta: -qty,
      reason,
    });
    onClose();
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="rounded-t-lg sm:rounded-lg p-0 bg-parchment-light text-walnut border border-brass/40 shadow-xl backdrop:bg-walnut-dark/60 w-[min(420px,100vw)] mb-0 sm:mb-auto"
    >
      <div className="p-4 space-y-4">
        <div className="flex gap-3">
          <PhotoImg
            photo_id={product.photo_id}
            alt={product.name}
            className="w-16 h-16 object-cover rounded-md flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <h3 className="font-display text-lg truncate">{product.name}</h3>
            <div className="text-sm text-walnut/70">
              List {fmtCurrency(product.list_price)} · {product.quantity_on_hand}{' '}
              on hand
            </div>
          </div>
        </div>

        <div>
          <label className="label">Quantity</label>
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary !px-3"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
            >
              −
            </button>
            <input
              type="number"
              min="1"
              className="input text-center"
              value={qty}
              onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
            />
            <button
              className="btn-secondary !px-3"
              onClick={() => setQty((q) => q + 1)}
            >
              +
            </button>
          </div>
        </div>

        <button
          type="button"
          className="text-xs text-walnut/60 underline"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? 'Hide' : 'Show'} price override
        </button>
        {showAdvanced && (
          <div>
            <label className="label">Override unit price</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="input"
              placeholder={`Default ${fmtCurrency(product.list_price)}`}
              value={priceOverride}
              onChange={(e) => setPriceOverride(e.target.value)}
            />
          </div>
        )}

        <div className="text-right text-sm">
          <span className="text-walnut/60">Line total:</span>{' '}
          <strong>{fmtCurrency(unitPrice * qty)}</strong>
        </div>

        <button className="btn-primary w-full" onClick={handleAddToCart}>
          Add to cart
        </button>

        <div className="grid grid-cols-3 gap-2">
          <button className="btn-secondary text-sm" onClick={handleSoldImmediate}>
            Sold
          </button>
          <button
            className="btn-secondary text-sm"
            onClick={() => handleLost('lost')}
          >
            Lost
          </button>
          <button
            className="btn-secondary text-sm"
            onClick={() => handleLost('broken')}
          >
            Broken
          </button>
        </div>

        <div className="text-center pt-2">
          <button className="text-walnut/60 text-sm hover:underline" onClick={onClose}>
            Cancel
          </button>
          {' · '}
          <button
            className="text-walnut/60 text-sm hover:underline"
            onClick={() => {
              onClose();
              navigate('/cart');
            }}
          >
            View cart →
          </button>
        </div>
      </div>
    </dialog>
  );
}
