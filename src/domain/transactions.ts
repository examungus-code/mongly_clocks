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
      for (let i = 0; i < input.lines.length; i++) {
        const line = input.lines[i];
        const lineRow = lineRows[i];
        const product = await db.products.get(line.product_id);
        if (!product) throw new Error(`product ${line.product_id} missing`);

        // Main sold adjustment for the product itself.
        await db.adjustments.add({
          id: uuid(),
          product_id: line.product_id,
          delta: -line.quantity,
          reason: 'sold',
          transaction_id: txId,
          line_item_id: lineRow.id,
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
              line_item_id: lineRow.id,
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

/**
 * Change the subtype of an already-recorded sale. Adjusts component
 * inventory accordingly: if the old subtype had a linked component, the
 * existing 'sold_component' adjustment for this line is reversed and the
 * component qty is restored. If the new subtype has a linked component, a
 * fresh 'sold_component' adjustment is created and that component's qty
 * decremented.
 *
 * Uses InventoryAdjustment.line_item_id to find the right component row
 * unambiguously. For pre-line_item_id data, falls back to matching by
 * transaction + reason + old component product id (works as long as one
 * line per linked component, which is the only case the booth flow creates).
 */
export async function changeLineItemSubtype(
  line_item_id: ID,
  new_subtype: string | null
): Promise<void> {
  await db.transaction(
    'rw',
    [db.line_items, db.adjustments, db.products],
    async () => {
      const line = await db.line_items.get(line_item_id);
      if (!line) throw new Error('line item not found');
      const product = await db.products.get(line.product_id);
      if (!product) throw new Error('product not found');

      const links = product.subtype_links ?? {};
      const oldSubtype = line.subtype;
      const oldComponentId =
        oldSubtype && links[oldSubtype] ? links[oldSubtype] : null;
      const newComponentId =
        new_subtype && links[new_subtype] ? links[new_subtype] : null;

      // Reverse the existing component adjustment if there was one.
      if (oldComponentId) {
        const candidates = await db.adjustments
          .where('transaction_id')
          .equals(line.transaction_id)
          .filter(
            (a) =>
              a.reason === 'sold_component' &&
              a.product_id === oldComponentId &&
              (a.line_item_id ? a.line_item_id === line_item_id : true)
          )
          .toArray();
        const old = candidates[0];
        if (old) {
          const oldComponent = await db.products.get(oldComponentId);
          if (oldComponent) {
            await db.products.update(oldComponentId, {
              quantity_on_hand: oldComponent.quantity_on_hand + -old.delta,
              updated_at: Date.now(),
            });
          }
          await db.adjustments.delete(old.id);
        }
      }

      // Add a new component adjustment if the new subtype has a link.
      if (newComponentId) {
        const newComponent = await db.products.get(newComponentId);
        if (newComponent) {
          await db.adjustments.add({
            id: uuid(),
            product_id: newComponentId,
            delta: -line.quantity,
            reason: 'sold_component',
            transaction_id: line.transaction_id,
            line_item_id: line.id,
            note: `from ${product.name} · ${new_subtype}`,
            occurred_at: Date.now(),
            created_at: Date.now(),
          });
          await db.products.update(newComponentId, {
            quantity_on_hand: newComponent.quantity_on_hand - line.quantity,
            updated_at: Date.now(),
          });
        }
      }

      // Finally, update the line item's recorded subtype.
      await db.line_items.update(line_item_id, { subtype: new_subtype });
    }
  );
}
