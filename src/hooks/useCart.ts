// Cart is module-level singleton — it's the "active customer" at the booth and
// only one exists. Lives in memory only; "Complete Transaction" persists it.

import { useSyncExternalStore } from 'react';
import type { CartLine } from '../domain/transactions';

interface CartState {
  lines: CartLine[];
}

let state: CartState = { lines: [] };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function getCart(): CartState {
  return state;
}

export function addToCart(line: CartLine): void {
  // Merge into existing line only when product + subtype + unit_price all match.
  // Different subtypes are kept as separate lines so the customer's receipt
  // (and the CSV) reflects which variant they actually bought.
  const existingIdx = state.lines.findIndex(
    (l) =>
      l.product_id === line.product_id &&
      l.unit_price === line.unit_price &&
      l.subtype === line.subtype
  );
  if (existingIdx >= 0) {
    const updated = [...state.lines];
    updated[existingIdx] = {
      ...updated[existingIdx],
      quantity: updated[existingIdx].quantity + line.quantity,
    };
    state = { lines: updated };
  } else {
    state = { lines: [...state.lines, line] };
  }
  emit();
}

export function updateCartLine(
  index: number,
  patch: Partial<CartLine>
): void {
  const updated = [...state.lines];
  updated[index] = { ...updated[index], ...patch };
  state = { lines: updated };
  emit();
}

export function removeCartLine(index: number): void {
  state = { lines: state.lines.filter((_, i) => i !== index) };
  emit();
}

export function clearCart(): void {
  state = { lines: [] };
  emit();
}

export function useCart(): CartState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getCart,
    getCart
  );
}
