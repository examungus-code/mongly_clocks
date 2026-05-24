// Inventory adjustments — every quantity change goes through here so the
// adjustments log stays the source of truth and Product.quantity_on_hand
// stays an honest cache.

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
    note: input.note ?? '',
    occurred_at: input.occurred_at ?? now,
    created_at: now,
  };

  await db.transaction('rw', [db.adjustments, db.products], async () => {
    await db.adjustments.add(row);
    const product = await db.products.get(input.product_id);
    if (!product) throw new Error(`product ${input.product_id} not found`);
    await db.products.update(input.product_id, {
      quantity_on_hand: product.quantity_on_hand + input.delta,
      updated_at: now,
    });
  });

  return row;
}

/**
 * Recompute Product.quantity_on_hand from scratch by summing the adjustments
 * log. Run after a Drive Pull or whenever the cache is suspect.
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
        if (total !== product.quantity_on_hand) {
          await db.products.update(product.id, {
            quantity_on_hand: total,
            updated_at: Date.now(),
          });
        }
      }
    }
  );
}
