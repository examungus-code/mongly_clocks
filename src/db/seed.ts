// First-run seed: sync metadata row and app prefs, with a device label
// derived from the user agent so multiple devices have distinct labels in the
// sync indicator.

import { db } from './schema';

function guessDeviceLabel(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet/.test(ua)) return 'Tablet';
  if (/iphone|android.*mobile|mobile/.test(ua)) return 'Phone';
  if (/macintosh|windows nt|linux/.test(ua)) return 'Desktop';
  return 'Device';
}

/**
 * One-off migration from sessions to picking a festival on the Sell screen:
 * if this install predates current_festival_id, start it at the festival of
 * the session that was open (or "No festival" if none was). Runs on every
 * app boot — cheap and idempotent.
 */
async function carryOverOpenSessionFestival(): Promise<void> {
  const prefs = await db.prefs.get('prefs');
  if (!prefs || prefs.current_festival_id !== undefined) return;
  const open = await db.session.get('session');
  await db.prefs.update('prefs', {
    current_festival_id: open?.started_at ? open.festival_id : null,
  });
}

export async function seedIfNeeded(): Promise<void> {
  await carryOverOpenSessionFestival();
  const prefs = await db.prefs.get('prefs');
  if (prefs?.schema_seeded) return;

  await db.transaction('rw', [db.sync_meta, db.prefs], async () => {
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
      current_festival_id: null,
    });
  });
}
