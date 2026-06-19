// Variant picker — handles up to two independent axes (subtypes + sizes).
//
// Single-axis behavior: one tap on a button completes the sale (no extra
// confirmation). Two-axis behavior: both must be picked, then a Sell button
// at the bottom finalizes.

import { useEffect, useRef, useState } from 'react';
import { type Product } from '../../db/schema';
import { PhotoImg } from '../../components/PhotoImg';

interface Props {
  product: Product;
  /** Effective subtypes (may be inherited from the product's category). */
  subtypes: string[];
  /** Per-product sizes. Sizes are product-level only — no inheritance. */
  sizes: string[];
  onPick: (subtype: string | null, size: string | null) => void;
  onCancel: () => void;
}

export function SubtypePicker({
  product,
  subtypes,
  sizes,
  onPick,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);

  const hasSubtypes = subtypes.length > 0;
  const hasSizes = sizes.length > 0;
  const isMultiAxis = hasSubtypes && hasSizes;

  const [selSubtype, setSelSubtype] = useState<string | null>(null);
  const [selSize, setSelSize] = useState<string | null>(null);

  function tapSubtype(s: string) {
    if (isMultiAxis) {
      setSelSubtype(s);
    } else {
      onPick(s, null);
    }
  }
  function tapSize(z: string) {
    if (isMultiAxis) {
      setSelSize(z);
    } else {
      onPick(null, z);
    }
  }

  const canSell =
    (!hasSubtypes || selSubtype !== null) &&
    (!hasSizes || selSize !== null);

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      className="rounded-lg p-0 bg-white text-walnut border border-brass/40 shadow-xl backdrop:bg-black/50 w-[min(480px,calc(100vw-2rem))]"
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
              {isMultiAxis
                ? 'Pick a subtype and a size, then Sell'
                : hasSubtypes
                ? 'Pick a subtype'
                : 'Pick a size'}
            </div>
          </div>
        </div>

        {hasSubtypes && (
          <div>
            <div className="text-xs uppercase text-brass-dark font-ui mb-2">
              Subtype
            </div>
            <div className="grid grid-cols-2 gap-2">
              {subtypes.map((s) => (
                <button
                  key={s}
                  className={
                    isMultiAxis
                      ? `px-3 py-3 rounded-md border font-ui text-sm min-h-[44px] ${
                          selSubtype === s
                            ? 'bg-brass text-walnut border-brass'
                            : 'bg-white text-walnut border-walnut/20 hover:bg-brass-soft'
                        }`
                      : 'btn-primary !justify-center text-base'
                  }
                  onClick={() => tapSubtype(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {hasSizes && (
          <div>
            <div className="text-xs uppercase text-brass-dark font-ui mb-2">
              Size
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {sizes.map((z) => {
                const stockKey = product.size_stock?.[z] ?? 0;
                return (
                  <button
                    key={z}
                    className={
                      isMultiAxis
                        ? `px-3 py-3 rounded-md border font-ui text-sm min-h-[44px] flex flex-col items-center ${
                            selSize === z
                              ? 'bg-brass text-walnut border-brass'
                              : 'bg-white text-walnut border-walnut/20 hover:bg-brass-soft'
                          }`
                        : 'btn-primary !justify-center text-base flex flex-col gap-0.5'
                    }
                    onClick={() => tapSize(z)}
                  >
                    <span>{z}</span>
                    <span
                      className={`text-[10px] font-normal ${
                        isMultiAxis ? 'text-walnut/60' : 'text-walnut/70'
                      }`}
                    >
                      qty {stockKey}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {isMultiAxis && (
          <button
            className="btn-primary w-full text-base"
            disabled={!canSell}
            onClick={() => onPick(selSubtype, selSize)}
          >
            Sell
            {(selSubtype || selSize) && (
              <span className="text-xs opacity-70 ml-2">
                {selSubtype}
                {selSubtype && selSize ? ' · ' : ''}
                {selSize}
              </span>
            )}
          </button>
        )}

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
