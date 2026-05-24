// Pull cloud data from Drive into the local DB, replacing everything.

import { db, SCHEMA_VERSION } from '../db/schema';
import {
  DATA_FILE,
  downloadFile,
  findFileById,
  findFileByName,
  FOLDER_NAME,
  listChildren,
  META_FILE,
  PHOTOS_FOLDER,
} from './drive-client';
import { restoreLocal, type SnapshotPayload } from './serialize';
import { recomputeAllQuantities } from '../domain/inventory';

export interface PullProgress {
  stage:
    | 'finding-folder'
    | 'downloading-data'
    | 'downloading-photos'
    | 'restoring'
    | 'done';
  message: string;
  photo_index?: number;
  photo_total?: number;
}

export async function pullFromDrive(
  onProgress: (p: PullProgress) => void
): Promise<void> {
  onProgress({ stage: 'finding-folder', message: 'Locating Drive folder…' });
  const meta = await db.sync_meta.get('sync');
  const folder = await locateFolder(meta?.drive_folder_id ?? null);
  if (!folder) {
    throw new Error(
      'No Drive folder found yet — push from another device first, or push from this one to initialize.'
    );
  }
  await db.sync_meta.update('sync', { drive_folder_id: folder.id });

  // 1. Download meta.json first to validate schema version
  const metaFile = await findFileByName(META_FILE, folder.id);
  let cloudDeviceLabel: string | null = null;
  let cloudModifiedAt: number | null = null;
  if (metaFile) {
    const blob = await downloadFile(metaFile.id);
    const text = await blob.text();
    const parsed = JSON.parse(text) as {
      schema_version: number;
      last_modified: number;
      device_label?: string;
    };
    if (parsed.schema_version > SCHEMA_VERSION) {
      throw new Error(
        `Cloud data was written by a newer version of the app (schema ${parsed.schema_version} > ${SCHEMA_VERSION}). Update before pulling.`
      );
    }
    cloudDeviceLabel = parsed.device_label ?? null;
    cloudModifiedAt = parsed.last_modified;
  }

  // 2. Download data.json
  onProgress({ stage: 'downloading-data', message: 'Downloading data.json…' });
  const dataFile = await findFileByName(DATA_FILE, folder.id);
  if (!dataFile) throw new Error('No data.json found in Drive folder.');
  const dataBlob = await downloadFile(dataFile.id);
  const snapshot = JSON.parse(await dataBlob.text()) as SnapshotPayload;

  // 3. Download all photos referenced by the snapshot
  const photosFolder = await findFileByName(PHOTOS_FOLDER, folder.id);
  const freshPhotos = new Map<string, File>();
  if (photosFolder && snapshot.photos.length > 0) {
    const remotePhotos = await listChildren(photosFolder.id);
    const byName = new Map(remotePhotos.map((f) => [f.name, f]));
    onProgress({
      stage: 'downloading-photos',
      message: 'Downloading photos…',
      photo_index: 0,
      photo_total: snapshot.photos.length,
    });
    let i = 0;
    for (const ref of snapshot.photos) {
      const name = `${ref.id}${ref.ext}`;
      const remote = byName.get(name);
      if (remote) {
        const blob = await downloadFile(remote.id);
        // Reconstruct a File with original name + type
        const file = new File([blob], name, {
          type: blob.type || guessMimeFromExt(ref.ext),
        });
        freshPhotos.set(ref.id, file);
      }
      i++;
      onProgress({
        stage: 'downloading-photos',
        message: `Downloading photos (${i}/${snapshot.photos.length})`,
        photo_index: i,
        photo_total: snapshot.photos.length,
      });
    }
  }

  // 4. Replace local DB
  onProgress({ stage: 'restoring', message: 'Restoring local database…' });
  await restoreLocal(snapshot, freshPhotos);

  // 5. Quantity cache may drift after a wholesale replace — recompute.
  await recomputeAllQuantities();

  await db.sync_meta.update('sync', {
    last_pull_at: Date.now(),
    last_cloud_modified_at: cloudModifiedAt,
    last_cloud_device_label: cloudDeviceLabel,
  });

  onProgress({ stage: 'done', message: 'Pull complete.' });
}

async function locateFolder(savedId: string | null) {
  if (savedId) {
    const existing = await findFileById(savedId);
    if (existing) return existing;
  }
  return findFileByName(FOLDER_NAME);
}

function guessMimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.heic':
      return 'image/heic';
    default:
      return 'application/octet-stream';
  }
}
