// First-run seed: payment types, an empty session row, sync metadata row, and
// a device label derived from the user agent so multiple devices have distinct
// labels in the sync indicator.

import { v4 as uuid } from 'uuid';
import { db } from './schema';

function guessDeviceLabel(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet/.test(ua)) return 'Tablet';
  if (/iphone|android.*mobile|mobile/.test(ua)) return 'Phone';
  if (/macintosh|windows nt|linux/.test(ua)) return 'Desktop';
  return 'Device';
}

export async function seedIfNeeded(): Promise<void> {
  const prefs = await db.prefs.get('prefs');
  if (prefs?.schema_seeded) return;

  const now = Date.now();
  await db.transaction(
    'rw',
    [db.payment_types, db.session, db.sync_meta, db.prefs],
    async () => {
      const seedPayments = [
        { name: 'Cash', sort_order: 0 },
        { name: 'Card', sort_order: 1 },
        { name: 'Venmo', sort_order: 2 },
        { name: 'Other', sort_order: 3 },
      ];
      await db.payment_types.bulkAdd(
        seedPayments.map((p) => ({
          id: uuid(),
          name: p.name,
          sort_order: p.sort_order,
          archived: false,
          created_at: now,
          updated_at: now,
        }))
      );

      await db.session.put({
        id: 'session',
        festival_id: null,
        default_payment_type_id: null,
        started_at: null,
      });

      await db.sync_meta.put({
        id: 'sync',
        last_push_at: null,
        last_pull_at: null,
        last_cloud_modified_at: null,
        last_cloud_device_label: null,
        device_label: guessDeviceLabel(),
        drive_folder_id: null,
      });

      await db.prefs.put({ id: 'prefs', schema_seeded: true });
    }
  );
}
