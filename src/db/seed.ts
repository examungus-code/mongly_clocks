// First-run seed: session singleton, sync metadata row, and a device label
// derived from the user agent so multiple devices have distinct labels in the
// sync indicator.

import { v4 as uuid } from 'uuid';
import { db } from './schema';

function guessDeviceLabel(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet/.test(ua)) return 'Tablet';
  if (/iphone|android.*mobile|mobile/.test(ua)) return 'Phone';
  if (/macintosh|windows nt|linux/.test(ua)) return 'Desktop';
  return 'Device';
}

/**
 * One-off migration: if the Session singleton is active but there's no
 * SessionRecord for it (upgrading from a pre-v4 install where she was mid-
 * session at the moment of update), backfill a record so the new history
 * dropdown shows it. Runs on every app boot — cheap and idempotent.
 */
async function backfillActiveSessionRecord(): Promise<void> {
  const singleton = await db.session.get('session');
  if (!singleton?.started_at) return;
  const matching = await db.session_records
    .where('started_at')
    .equals(singleton.started_at)
    .first();
  if (matching) return;
  const now = Date.now();
  await db.session_records.add({
    id: uuid(),
    festival_id: singleton.festival_id,
    started_at: singleton.started_at,
    ended_at: null,
    created_at: now,
    updated_at: now,
  });
}

export async function seedIfNeeded(): Promise<void> {
  await backfillActiveSessionRecord();
  const prefs = await db.prefs.get('prefs');
  if (prefs?.schema_seeded) return;

  await db.transaction(
    'rw',
    [db.session, db.sync_meta, db.prefs],
    async () => {
      await db.session.put({
        id: 'session',
        festival_id: null,
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

      await db.prefs.put({
        id: 'prefs',
        schema_seeded: true,
        return_to_top_after_sale: false,
      });
    }
  );
}
