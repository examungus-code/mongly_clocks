// Push local data to Drive. Overwrites the cloud copy entirely.

import { db, SCHEMA_VERSION } from '../db/schema';
import {
  createFolder,
  DATA_FILE,
  deleteFile,
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
    | 'cleaning-up'
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

  // 3. Upload data.json (replace if present)
  onProgress({ stage: 'uploading-data', message: 'Uploading data.json…' });
  const dataBlob = new Blob([JSON.stringify(snapshot)], {
    type: 'application/json',
  });
  const existingData = await findFileByName(DATA_FILE, folder.id);
  await uploadFile(DATA_FILE, folder.id, dataBlob, existingData?.id);

  // 4. Upload meta.json
  const metaBlob = new Blob(
    [
      JSON.stringify({
        schema_version: SCHEMA_VERSION,
        last_modified: Date.now(),
        device_label: deviceLabel,
      }),
    ],
    { type: 'application/json' }
  );
  const existingMeta = await findFileByName(META_FILE, folder.id);
  await uploadFile(META_FILE, folder.id, metaBlob, existingMeta?.id);

  // 5. Sync photos: upload any local photo not present in Drive folder by id+ext
  const localPhotos = await db.photos.toArray();
  const remotePhotos = await listChildren(photosFolder.id);
  const remoteByName = new Map(remotePhotos.map((f) => [f.name, f]));

  onProgress({
    stage: 'uploading-photos',
    message: 'Syncing photos…',
    photo_index: 0,
    photo_total: localPhotos.length,
  });

  const expectedNames = new Set<string>();
  for (let i = 0; i < localPhotos.length; i++) {
    const photo = localPhotos[i];
    const ext = deriveExt(photo.file);
    const name = `${photo.id}${ext}`;
    expectedNames.add(name);
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

  // 6. Delete remote photos not referenced anymore
  onProgress({ stage: 'cleaning-up', message: 'Removing stale photos…' });
  for (const remote of remotePhotos) {
    if (!expectedNames.has(remote.name)) {
      await deleteFile(remote.id);
    }
  }

  // 7. Update local sync metadata
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
