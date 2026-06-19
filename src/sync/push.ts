// Push local data to Drive. NON-DESTRUCTIVE: every push creates a new
// timestamped data file (data-YYYYMMDD-HHMMSS.json) and never deletes the
// previous one. Photos are never deleted either, even if they're not
// referenced by the current snapshot — they might still be referenced by
// an older version we want to be able to roll back to.

import { db, SCHEMA_VERSION } from '../db/schema';
import {
  buildDataFilename,
  createFolder,
  findFileById,
  findFileByName,
  FOLDER_NAME,
  listChildren,
  META_FILE,
  PHOTOS_FOLDER,
  uploadFile,
} from './drive-client';
import { deriveExt, snapshotLocal } from './serialize';

export interface PushProgress {
  stage:
    | 'preparing'
    | 'finding-folder'
    | 'uploading-data'
    | 'uploading-photos'
    | 'done';
  message: string;
  photo_index?: number;
  photo_total?: number;
}

export async function pushToDrive(
  onProgress: (p: PushProgress) => void
): Promise<void> {
  onProgress({ stage: 'preparing', message: 'Bundling local data…' });
  const snapshot = await snapshotLocal();
  const meta = await db.sync_meta.get('sync');
  const deviceLabel = meta?.device_label ?? 'Device';

  // 1. Locate or create root folder
  onProgress({ stage: 'finding-folder', message: 'Locating Drive folder…' });
  const folder = await ensureRootFolder(meta?.drive_folder_id ?? null);
  await db.sync_meta.update('sync', { drive_folder_id: folder.id });

  // 2. Locate or create photos subfolder
  let photosFolder = await findFileByName(PHOTOS_FOLDER, folder.id);
  if (!photosFolder) {
    photosFolder = await createFolder(PHOTOS_FOLDER, folder.id);
  }

  // 3. Upload a NEW versioned data file (never overwrites a previous one).
  const dataFilename = buildDataFilename();
  onProgress({
    stage: 'uploading-data',
    message: `Uploading ${dataFilename}…`,
  });
  const dataBlob = new Blob([JSON.stringify(snapshot)], {
    type: 'application/json',
  });
  await uploadFile(dataFilename, folder.id, dataBlob);

  // 4. Update meta.json with a pointer to the latest version. Old versions
  //    remain on Drive untouched.
  const metaBlob = new Blob(
    [
      JSON.stringify({
        schema_version: SCHEMA_VERSION,
        last_modified: Date.now(),
        device_label: deviceLabel,
        latest_data_file: dataFilename,
      }),
    ],
    { type: 'application/json' }
  );
  const existingMeta = await findFileByName(META_FILE, folder.id);
  await uploadFile(META_FILE, folder.id, metaBlob, existingMeta?.id);

  // 5. Upload any local photos that aren't on Drive yet. We NEVER delete
  //    remote photos — they may still be referenced by older versioned
  //    snapshots that the operator might want to restore.
  const localPhotos = await db.photos.toArray();
  const remotePhotos = await listChildren(photosFolder.id);
  const remoteByName = new Map(remotePhotos.map((f) => [f.name, f]));

  onProgress({
    stage: 'uploading-photos',
    message: 'Syncing photos…',
    photo_index: 0,
    photo_total: localPhotos.length,
  });

  for (let i = 0; i < localPhotos.length; i++) {
    const photo = localPhotos[i];
    const ext = deriveExt(photo.file);
    const name = `${photo.id}${ext}`;
    if (!remoteByName.has(name)) {
      await uploadFile(name, photosFolder.id, photo.file);
    }
    onProgress({
      stage: 'uploading-photos',
      message: `Uploading photos (${i + 1}/${localPhotos.length})`,
      photo_index: i + 1,
      photo_total: localPhotos.length,
    });
  }

  // 6. Update local sync metadata
  await db.sync_meta.update('sync', {
    last_push_at: Date.now(),
    last_cloud_modified_at: Date.now(),
    last_cloud_device_label: deviceLabel,
  });

  onProgress({ stage: 'done', message: 'Push complete.' });
}

async function ensureRootFolder(savedId: string | null) {
  if (savedId) {
    const existing = await findFileById(savedId);
    if (existing) return existing;
  }
  // Try to find by name in root
  const byName = await findFileByName(FOLDER_NAME);
  if (byName) return byName;
  // Otherwise create
  return createFolder(FOLDER_NAME);
}
