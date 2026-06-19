// Pull cloud data from Drive into the local DB, replacing everything.
//
// By default this pulls the most recent versioned snapshot (data-YYYYMMDD-
// HHMMSS.json) found in the Drive folder. The caller can pass an explicit
// file id (e.g. from the "older versions" UI on the Sync page) to restore a
// specific prior snapshot instead.

import { db, SCHEMA_VERSION } from '../db/schema';
import {
  downloadFile,
  findFileById,
  findFileByName,
  FOLDER_NAME,
  LEGACY_DATA_FILE,
  listChildren,
  META_FILE,
  parseDataFilename,
  PHOTOS_FOLDER,
  type DriveFile,
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

export interface DataVersion {
  /** Drive file id — useful for re-fetching this exact version. */
  id: string;
  /** Filename like "data-20260528-142345.json", or "data.json" for legacy. */
  name: string;
  /** Parsed timestamp (ms) — taken from the filename, or modifiedTime fallback. */
  timestamp_ms: number;
  /** True when this was the pre-versioning singleton file. */
  legacy: boolean;
}

export async function pullFromDrive(
  onProgress: (p: PullProgress) => void,
  /** Optional: a specific version id from listDataVersions(). Defaults to latest. */
  versionId?: string
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

  // Decide which file to download.
  let target: DriveFile | null = null;
  if (versionId) {
    target = await findFileById(versionId);
    if (!target) {
      throw new Error('That version is no longer on Drive.');
    }
  } else {
    const versions = await listDataVersionsIn(folder.id);
    if (versions.length === 0) {
      throw new Error(
        'No data file found in the Drive folder. Push from another device first.'
      );
    }
    const latest = versions[0]; // sorted desc
    target = { id: latest.id, name: latest.name, mimeType: 'application/json' };
  }

  // 1. Download meta.json (informational only — pulled version is decided above)
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

  // 2. Download data file
  onProgress({
    stage: 'downloading-data',
    message: `Downloading ${target.name}…`,
  });
  const dataBlob = await downloadFile(target.id);
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

/**
 * List every available data snapshot in the Drive folder, newest first.
 * Used by the Sync page to show recent versions she can roll back to.
 */
export async function listDataVersions(): Promise<DataVersion[]> {
  const meta = await db.sync_meta.get('sync');
  const folder = await locateFolder(meta?.drive_folder_id ?? null);
  if (!folder) return [];
  return listDataVersionsIn(folder.id);
}

async function listDataVersionsIn(folderId: string): Promise<DataVersion[]> {
  const children = await listChildren(folderId);
  const versions: DataVersion[] = [];
  for (const f of children) {
    const ts = parseDataFilename(f.name);
    if (ts !== null) {
      versions.push({
        id: f.id,
        name: f.name,
        timestamp_ms: ts,
        legacy: false,
      });
    } else if (f.name === LEGACY_DATA_FILE) {
      versions.push({
        id: f.id,
        name: f.name,
        timestamp_ms: f.modifiedTime
          ? Date.parse(f.modifiedTime)
          : 0,
        legacy: true,
      });
    }
  }
  versions.sort((a, b) => b.timestamp_ms - a.timestamp_ms);
  return versions;
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
