// Slim modal shown only when a product has subtypes but no default is set.
// One tap on a subtype completes the sale — no extra steps.

import { useEffect, useRef } from 'react';
import { type Product } from '../../db/schema';
import { PhotoImg } from '../../components/PhotoImg';
import { fmtCurrency } from '../../utils/format';

interface Props {
  product: Product;
  onPick: (subtype: string) => void;
  onCancel: () => void;
}

export function SubtypePicker({ product, onPick, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);

  const subtypes = product.subtypes ?? [];

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      className="rounded-lg p-0 bg-parchment-light text-walnut border border-brass/40 shadow-xl backdrop:bg-walnut-dark/60 w-[min(420px,calc(100vw-2rem))]"
    >
      <div className="p-4 space-y-4">
        <div className="flex gap-3">
          <PhotoImg
            photo_id={product.photo_id}
            alt={product.name}
            className="w-14 h-14 object-cover rounded-md flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <h3 className="font-display text-lg truncate">{product.name}</h3>
            <div className="text-sm text-walnut/70">
              {fmtCurrency(product.list_price)} · pick a subtype to sell
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {subtypes.map((s) => (
            <button
              key={s}
              className="btn-primary !justify-center text-base"
              onClick={() => onPick(s)}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="text-center">
          <button
            className="text-walnut/60 text-sm hover:underline"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
