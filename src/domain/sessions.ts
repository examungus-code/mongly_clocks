// Session records: removing ones started by mistake.
//
// Sales aren't linked to a session by id — a transaction carries its own
// timestamp and festival. A session "has sales" when any transaction tagged
// with its festival happened between its start and end (or any time after
// the start, if it was never ended). Deleting a session record never touches
// sales or inventory; it only drops the session from the session lists and
// from the Data page's weekend count. Even so, only sessions with no sales
// can be deleted, and never the one currently open on the Sell screen.

import {
  db,
  type ID,
  type SessionRecord,
  type Transaction,
} from '../db/schema';

export function salesInSession(
  session: Pick<SessionRecord, 'festival_id' | 'started_at' | 'ended_at'>,
  transactions: Pick<Transaction, 'festival_id' | 'occurred_at'>[]
): number {
  const end = session.ended_at ?? Infinity;
  return transactions.filter(
    (t) =>
      t.festival_id === session.festival_id &&
      t.occurred_at >= session.started_at &&
      t.occurred_at <= end
  ).length;
}

/** Delete a session record that has no sales and isn't the open session. */
export async function deleteEmptySession(id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [db.session_records, db.session, db.transactions],
    async () => {
      const session = await db.session_records.get(id);
      if (!session) return;
      const open = await db.session.get('session');
      if (open?.started_at === session.started_at) {
        throw new Error(
          'End this session on the Sell screen before deleting it.'
        );
      }
      const transactions = await db.transactions
        .where('occurred_at')
        .aboveOrEqual(session.started_at)
        .toArray();
      if (salesInSession(session, transactions) > 0) {
        throw new Error('This session has sales, so it can’t be deleted.');
      }
      await db.session_records.delete(id);
    }
  );
}
