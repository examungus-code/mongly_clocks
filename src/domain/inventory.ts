// Inventory adjustments — every quantity change goes through here so the
// adjustments log stays the source of truth and Product.quantity_on_hand
// (plus size_stock for sized products) stays an honest cache.

import { v4 as uuid } from 'uuid';
import {
  db,
  type AdjustmentReason,
  type ID,
  type InventoryAdjustment,
} from '../db/schema';

export interface AdjustmentInput {
  product_id: ID;
  delta: number;
  reason: AdjustmentReason;
  note?: string;
  transaction_id?: ID | null;
  occurred_at?: number;
  /**
   * For sized products, which size pool this adjustment targets.
   * Required if the product has sizes; ignored otherwise.
   */
  size?: string | null;
}

/** Write an adjustment and update the cached quantity in one transaction. */
export async function recordAdjustment(
  input: AdjustmentInput
): Promise<InventoryAdjustment> {
  const now = Date.now();
  const row: InventoryAdjustment = {
    id: uuid(),
    product_id: input.product_id,
    delta: input.delta,
    reason: input.reason,
    transaction_id: input.transaction_id ?? null,
    size: input.size ?? null,
    note: input.note ?? '',
    occurred_at: input.occurred_at ?? now,
    created_at: now,
  };

  await db.transaction('rw', [db.adjustments, db.products], async () => {
    await db.adjustments.add(row);
    const product = await db.products.get(input.product_id);
    if (!product) throw new Error(`product ${input.product_id} not found`);
    const patch: Partial<typeof product> = { updated_at: now };
    patch.quantity_on_hand = product.quantity_on_hand + input.delta;
    // Per-size pool, if applicable. Defensive against missing size_stock
    // for legacy rows: rebuild from scratch with the requested key.
    if (input.size && (product.sizes ?? []).includes(input.size)) {
      const nextStock = { ...(product.size_stock ?? {}) };
      nextStock[input.size] = (nextStock[input.size] ?? 0) + input.delta;
      patch.size_stock = nextStock;
    }
    await db.products.update(input.product_id, patch);
  });

  return row;
}

/**
 * Delete a single inventory adjustment and roll the cached quantity back by
 * the same delta. Intended for non-sale adjustments (restocked, lost, broken,
 * manual_correction) where a row is a freestanding event. For 'sold'
 * adjustments, the caller should delete the parent transaction via
 * deleteTransaction instead — that path also removes line items and the tx
 * row so history stays consistent.
 */
export async function deleteAdjustment(adjustment_id: string): Promise<void> {
  await db.transaction('rw', [db.adjustments, db.products], async () => {
    const adj = await db.adjustments.get(adjustment_id);
    if (!adj) return;
    const product = await db.products.get(adj.product_id);
    await db.adjustments.delete(adjustment_id);
    if (product) {
      const patch: Partial<typeof product> = { updated_at: Date.now() };
      patch.quantity_on_hand = product.quantity_on_hand - adj.delta;
      if (adj.size && (product.sizes ?? []).includes(adj.size)) {
        const nextStock = { ...(product.size_stock ?? {}) };
        nextStock[adj.size] = (nextStock[adj.size] ?? 0) - adj.delta;
        patch.size_stock = nextStock;
      }
      await db.products.update(adj.product_id, patch);
    }
  });
}

/**
 * Recompute Product.quantity_on_hand (and size_stock for sized products)
 * from scratch by summing the adjustments log. Run after a Drive Pull or
 * whenever the cache is suspect.
 */
export async function recomputeAllQuantities(): Promise<void> {
  await db.transaction(
    'rw',
    [db.products, db.adjustments],
    async () => {
      const products = await db.products.toArray();
      for (const product of products) {
        const adjustments = await db.adjustments
          .where('product_id')
          .equals(product.id)
          .toArray();

        const total = adjustments.reduce((sum, a) => sum + a.delta, 0);
        const patch: Partial<typeof product> = { updated_at: Date.now() };

        if ((product.sizes ?? []).length > 0) {
          // Sum per size; sizes with no adjustments get zero.
          const nextStock: Record<string, number> = {};
          for (const s of product.sizes) nextStock[s] = 0;
          for (const a of adjustments) {
            if (a.size && nextStock[a.size] !== undefined) {
              nextStock[a.size] += a.delta;
            }
          }
          patch.size_stock = nextStock;
          patch.quantity_on_hand = Object.values(nextStock).reduce(
            (sum, v) => sum + v,
            0
          );
        } else {
          patch.quantity_on_hand = total;
        }

        await db.products.update(product.id, patch);
      }
    }
  );
}
