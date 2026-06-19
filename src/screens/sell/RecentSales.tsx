// Recent sales for the current session, with the ability to fully erase a
// mistaken sale. Deleting restores the quantity to inventory and removes the
// transaction from history entirely (no audit record — this is for mistakes,
// not refunds).

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ID } from '../../db/schema';
import { deleteTransaction } from '../../domain/transactions';
import { fmtDateTime } from '../../utils/format';
import { Confirm } from '../../components/Confirm';

export function RecentSales() {
  const session = useLiveQuery(() => db.session.get('session'));
  const sessionStart = session?.started_at ?? 0;

  // Show sales from this session, most recent first. If no session is active,
  // fall back to the last 24 hours so it's still useful right after End.
  const since =
    sessionStart > 0 ? sessionStart : Date.now() - 24 * 60 * 60 * 1000;

  const transactions = useLiveQuery(
    () =>
      db.transactions
        .where('occurred_at')
        .above(since)
        .reverse()
        .sortBy('occurred_at'),
    [since]
  );
  const lineItems = useLiveQuery(() => db.line_items.toArray());
  const products = useLiveQuery(() => db.products.toArray());

  const [pendingDelete, setPendingDelete] = useState<ID | null>(null);

  const productName = (id: ID) =>
    products?.find((p) => p.id === id)?.name ?? '(deleted product)';

  function linesFor(tx_id: ID) {
    return (lineItems ?? []).filter((l) => l.transaction_id === tx_id);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl">Recent sales</h2>
        <Link to="/sell" className="btn-ghost text-sm">
          ← Back to sell
        </Link>
      </div>

      <p className="text-xs text-walnut/60">
        {sessionStart > 0
          ? 'Sales from this session. Delete a sale to fully reverse it — the quantity is restored to inventory and the sale is removed from history.'
          : 'No active session. Showing sales from the last 24 hours.'}
      </p>

      {!transactions || transactions.length === 0 ? (
        <p className="text-walnut/60 text-center py-8">No sales yet.</p>
      ) : (
        <ul className="space-y-2">
          {transactions.map((tx) => {
            const lines = linesFor(tx.id);
            const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
            return (
              <li key={tx.id} className="card p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-walnut/70">
                    {fmtDateTime(tx.occurred_at)}
                  </div>
                  <div className="text-sm text-walnut/60">
                    {totalQty} item{totalQty === 1 ? '' : 's'}
                  </div>
                </div>
                <ul className="text-sm mt-1 space-y-0.5">
                  {lines.map((l) => (
                    <li key={l.id}>
                      {l.quantity} × {productName(l.product_id)}
                      {l.subtype && (
                        <span className="text-walnut/60"> · {l.subtype}</span>
                      )}
                      {l.size && (
                        <span className="text-walnut/60"> · size {l.size}</span>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="text-right mt-2">
                  <button
                    className="text-copper text-sm hover:underline"
                    onClick={() => setPendingDelete(tx.id)}
                  >
                    Delete sale
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Confirm
        open={!!pendingDelete}
        title="Delete this sale?"
        body="The items will be returned to inventory and this sale will be erased from history. This can't be undone."
        confirmLabel="Delete sale"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (pendingDelete) await deleteTransaction(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
