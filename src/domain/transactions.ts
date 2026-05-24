// Cart and transaction completion.
//
// The cart lives in React state (see useCart hook) — it isn't persisted to the
// DB until "Complete Transaction" runs. Completing a transaction writes:
//   - one Transaction row
//   - one TransactionLineItem per cart line
//   - one InventoryAdjustment (reason: 'sold') per cart line
// all atomically. If any step fails, nothing persists.

import { v4 as uuid } from 'uuid';
import {
  db,
  type ID,
  type Transaction,
  type TransactionLineItem,
} from '../db/schema';

export interface CartLine {
  product_id: ID;
  product_name: string; // snapshot for cart display
  quantity: number;
  unit_price: number;
  subtype: string | null; // null when the product has no subtypes defined
}

export interface CompleteTransactionInput {
  lines: CartLine[];
  festival_id: ID | null;
  payment_type_id: ID;
  note?: string;
  occurred_at?: number;
}

/**
 * Fully reverse a transaction as if it never happened. This is for fixing
 * mistakes at the booth — *not* refunds. Deletes:
 *   - the Transaction row
 *   - its TransactionLineItem rows
 *   - the 'sold' InventoryAdjustment rows referencing this transaction
 * and restores each affected product's quantity_on_hand by adding back the
 * deleted quantities.
 *
 * If she wants an actual refund audit trail later, that's a different
 * operation (record a refund adjustment, keep the original tx).
 */
export async function deleteTransaction(tx_id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [db.transactions, db.line_items, db.adjustments, db.products],
    async () => {
      const lines = await db.line_items
        .where('transaction_id')
        .equals(tx_id)
        .toArray();

      // Aggregate qty to restore per product so we make one update per product.
      const restorePerProduct = new Map<ID, number>();
      for (const line of lines) {
        restorePerProduct.set(
          line.product_id,
          (restorePerProduct.get(line.product_id) ?? 0) + line.quantity
        );
      }
      for (const [product_id, delta] of restorePerProduct) {
        const product = await db.products.get(product_id);
        if (!product) continue;
        await db.products.update(product_id, {
          quantity_on_hand: product.quantity_on_hand + delta,
          updated_at: Date.now(),
        });
      }

      // Delete the adjustments tagged with this transaction id.
      const soldIds = await db.adjustments
        .where('transaction_id')
        .equals(tx_id)
        .primaryKeys();
      await db.adjustments.bulkDelete(soldIds);

      // Delete line items, then the transaction.
      await db.line_items.bulkDelete(lines.map((l) => l.id));
      await db.transactions.delete(tx_id);
    }
  );
}

export async function completeTransaction(
  input: CompleteTransactionInput
): Promise<ID> {
  if (input.lines.length === 0) {
    throw new Error('cannot complete an empty transaction');
  }

  const now = input.occurred_at ?? Date.now();
  const txId = uuid();
  const total = input.lines.reduce(
    (sum, line) => sum + line.unit_price * line.quantity,
    0
  );

  const tx: Transaction = {
    id: txId,
    festival_id: input.festival_id,
    payment_type_id: input.payment_type_id,
    total,
    note: input.note ?? '',
    occurred_at: now,
    created_at: Date.now(),
  };

  const lineRows: TransactionLineItem[] = input.lines.map((line) => ({
    id: uuid(),
    transaction_id: txId,
    product_id: line.product_id,
    quantity: line.quantity,
    unit_price: line.unit_price,
    line_total: line.unit_price * line.quantity,
    subtype: line.subtype,
  }));

  await db.transaction(
    'rw',
    [db.transactions, db.line_items, db.adjustments, db.products],
    async () => {
      await db.transactions.add(tx);
      await db.line_items.bulkAdd(lineRows);
      for (const line of input.lines) {
        const product = await db.products.get(line.product_id);
        if (!product) throw new Error(`product ${line.product_id} missing`);
        await db.adjustments.add({
          id: uuid(),
          product_id: line.product_id,
          delta: -line.quantity,
          reason: 'sold',
          transaction_id: txId,
          note: '',
          occurred_at: now,
          created_at: Date.now(),
        });
        await db.products.update(line.product_id, {
          quantity_on_hand: product.quantity_on_hand - line.quantity,
          updated_at: Date.now(),
        });
      }
    }
  );

  return txId;
}
