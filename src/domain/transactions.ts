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
 *   - every InventoryAdjustment row tagged with this transaction id (sold +
 *     sold_component)
 * and restores each affected product's quantity_on_hand by adding back the
 * net of every deleted adjustment. Driving restoration from the adjustments
 * (not from line items) is what makes component decrements roll back too.
 */
export async function deleteTransaction(tx_id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [db.transactions, db.line_items, db.adjustments, db.products],
    async () => {
      const adjustments = await db.adjustments
        .where('transaction_id')
        .equals(tx_id)
        .toArray();

      // Aggregate per-product reversal: negate the recorded delta. (A 'sold'
      // adjustment is -N, so reversal is +N. A 'sold_component' adjustment is
      // -1, so reversal is +1.)
      const restorePerProduct = new Map<ID, number>();
      for (const adj of adjustments) {
        restorePerProduct.set(
          adj.product_id,
          (restorePerProduct.get(adj.product_id) ?? 0) + -adj.delta
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

      const lineIds = await db.line_items
        .where('transaction_id')
        .equals(tx_id)
        .primaryKeys();
      await db.adjustments.bulkDelete(adjustments.map((a) => a.id));
      await db.line_items.bulkDelete(lineIds);
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

        // Main sold adjustment for the product itself.
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

        // Subtype component link: decrement the linked product too. Hidden
        // from the inventory log but still counts toward the linked
        // product's qty. Note carries provenance for debugging.
        const links = product.subtype_links ?? {};
        const componentId =
          line.subtype && links[line.subtype] ? links[line.subtype] : null;
        if (componentId) {
          const component = await db.products.get(componentId);
          if (component) {
            await db.adjustments.add({
              id: uuid(),
              product_id: componentId,
              delta: -line.quantity,
              reason: 'sold_component',
              transaction_id: txId,
              note: `from ${product.name} · ${line.subtype}`,
              occurred_at: now,
              created_at: Date.now(),
            });
            await db.products.update(componentId, {
              quantity_on_hand: component.quantity_on_hand - line.quantity,
              updated_at: Date.now(),
            });
          }
        }
      }
    }
  );

  return txId;
}
