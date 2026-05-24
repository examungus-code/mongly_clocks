// Google Drive client using Google Identity Services for OAuth and the Drive
// REST API for file operations.
//
// Requires a Google OAuth client ID set at build time as VITE_GOOGLE_CLIENT_ID.
// See SETUP_DRIVE.md for how to create one.
//
// Scope: drive.file — the app can only see files it created. The folder name
// is browsable in her Drive UI but other files in her Drive are invisible to
// the app.

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as
  | string
  | undefined;

declare global {
  // Minimal GIS surface — we only use the OAuth2 token client.
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; error?: string }) => void;
          }) => {
            requestAccessToken: (opts?: { prompt?: string }) => void;
          };
        };
      };
    };
  }
}

let gisLoaded: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (gisLoaded) return gisLoaded;
  gisLoaded = new Promise((resolve, reject) => {
    if (window.google?.accounts) return resolve();
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
  return gisLoaded;
}

let accessToken: string | null = null;
let tokenExpiresAt = 0;

export function isConfigured(): boolean {
  return !!CLIENT_ID;
}

export function isAuthed(): boolean {
  return !!accessToken && Date.now() < tokenExpiresAt;
}

/** Request an access token, prompting the user if needed. */
export async function authenticate(): Promise<string> {
  if (!CLIENT_ID) {
    throw new Error(
      'Drive sync not configured. Set VITE_GOOGLE_CLIENT_ID at build time.'
    );
  }
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID!,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error || 'No access token returned'));
          return;
        }
        accessToken = resp.access_token;
        // GIS tokens are typically valid for ~1 hour; refresh proactively.
        tokenExpiresAt = Date.now() + 55 * 60 * 1000;
        resolve(accessToken);
      },
    });
    client.requestAccessToken({ prompt: isAuthed() ? '' : 'consent' });
  });
}

async function ensureToken(): Promise<string> {
  if (isAuthed()) return accessToken!;
  return authenticate();
}

async function driveFetch(
  path: string,
  init: RequestInit = {},
  baseUrl: string = DRIVE_API
): Promise<Response> {
  const token = await ensureToken();
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Drive API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

// ---- File ops ----

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  parents?: string[];
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

export async function findFileByName(
  name: string,
  parent?: string
): Promise<DriveFile | null> {
  const q = [
    `name='${name.replace(/'/g, "\\'")}'`,
    'trashed=false',
    parent ? `'${parent}' in parents` : null,
  ]
    .filter(Boolean)
    .join(' and ');
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,modifiedTime,parents)',
    pageSize: '10',
  });
  const res = await driveFetch(`/files?${params.toString()}`);
  const json = (await res.json()) as { files: DriveFile[] };
  return json.files[0] ?? null;
}

export async function findFileById(id: string): Promise<DriveFile | null> {
  try {
    const res = await driveFetch(
      `/files/${id}?fields=id,name,mimeType,modifiedTime,parents,trashed`
    );
    const file = (await res.json()) as DriveFile & { trashed?: boolean };
    if (file.trashed) return null;
    return file;
  } catch {
    return null;
  }
}

export async function createFolder(
  name: string,
  parent?: string
): Promise<DriveFile> {
  const res = await driveFetch('/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      parents: parent ? [parent] : undefined,
    }),
  });
  return res.json();
}

export async function listChildren(folderId: string): Promise<DriveFile[]> {
  const all: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id,name,mimeType,modifiedTime)',
      pageSize: '1000',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await driveFetch(`/files?${params.toString()}`);
    const json = (await res.json()) as {
      files: DriveFile[];
      nextPageToken?: string;
    };
    all.push(...json.files);
    pageToken = json.nextPageToken;
  } while (pageToken);
  return all;
}

export async function uploadFile(
  name: string,
  parent: string,
  blob: Blob,
  existingId?: string
): Promise<DriveFile> {
  // multipart upload
  const metadata = existingId
    ? { name }
    : { name, parents: [parent] };
  const boundary = `----clockwork_${Math.random().toString(36).slice(2)}`;
  const meta = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const fileHeader = `--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`;
  const trailer = `\r\n--${boundary}--`;
  const body = new Blob([meta, fileHeader, blob, trailer], {
    type: `multipart/related; boundary=${boundary}`,
  });

  const path = existingId
    ? `/files/${existingId}?uploadType=multipart&fields=id,name,mimeType,modifiedTime`
    : `/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime`;
  const res = await driveFetch(
    path,
    {
      method: existingId ? 'PATCH' : 'POST',
      body,
    },
    DRIVE_UPLOAD_API
  );
  return res.json();
}

export async function downloadFile(id: string): Promise<Blob> {
  const res = await driveFetch(`/files/${id}?alt=media`);
  return res.blob();
}

export async function deleteFile(id: string): Promise<void> {
  await driveFetch(`/files/${id}`, { method: 'DELETE' });
}

export const FOLDER_NAME = 'Clockwork Traveler';
export const DATA_FILE = 'data.json';
export const META_FILE = 'meta.json';
export const PHOTOS_FOLDER = 'photos';
