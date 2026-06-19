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

// Persisted auth state. We keep the access token in localStorage so it
// survives page reloads (and PWA service-worker swaps) within its ~1-hour
// validity. We also remember the email of the connected account so future
// token requests can pre-select it via the `hint` parameter — that's what
// makes the account picker stop showing up after the first connection.
const STORAGE_KEY = 'clockwork_drive_auth';

interface PersistedAuth {
  access_token: string;
  expires_at: number; // ms epoch
  email: string | null;
}

function loadAuth(): PersistedAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedAuth;
  } catch {
    return null;
  }
}

function saveAuth(auth: PersistedAuth | null) {
  if (auth === null) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

let cached: PersistedAuth | null = loadAuth();

export function isConfigured(): boolean {
  return !!CLIENT_ID;
}

export function isAuthed(): boolean {
  return !!cached?.access_token && Date.now() < cached.expires_at;
}

/** Returns the connected Google email if we've successfully auth'd before. */
export function connectedEmail(): string | null {
  return cached?.email ?? null;
}

/** Wipe the cached auth — for "switch account" or "disconnect" affordances. */
export function disconnect() {
  cached = null;
  saveAuth(null);
}

/** Request an access token, prompting the user if needed. */
export async function authenticate(): Promise<string> {
  if (!CLIENT_ID) {
    throw new Error(
      'Drive sync not configured. Set VITE_GOOGLE_CLIENT_ID at build time.'
    );
  }
  if (isAuthed()) return cached!.access_token;
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID!,
      scope: SCOPE,
      // Hint tells Google to pre-select the previously connected account so
      // the account picker doesn't reappear on every refresh.
      hint: cached?.email ?? undefined,
      callback: async (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error || 'No access token returned'));
          return;
        }
        const access_token = resp.access_token;
        // GIS tokens are typically valid for ~1 hour; refresh proactively.
        const expires_at = Date.now() + 55 * 60 * 1000;

        // Resolve the user's email on first auth so we can hint with it on
        // subsequent silent refreshes. The Drive `about` endpoint works
        // with just the drive.file scope and returns user info without
        // needing the broader profile/email scopes.
        let email = cached?.email ?? null;
        if (!email) {
          try {
            const aboutRes = await fetch(
              `${DRIVE_API}/about?fields=user`,
              { headers: { Authorization: `Bearer ${access_token}` } }
            );
            if (aboutRes.ok) {
              const data = (await aboutRes.json()) as {
                user?: { emailAddress?: string };
              };
              email = data.user?.emailAddress ?? null;
            }
          } catch {
            /* email is a nice-to-have; failure shouldn't block sync */
          }
        }

        cached = { access_token, expires_at, email };
        saveAuth(cached);
        resolve(access_token);
      },
    });
    // First-time = consent prompt (one time). Subsequent = silent ('' lets
    // Google decide; combined with the hint above this is silent in nearly
    // every case where she's still signed into that account).
    const prompt = cached?.email ? '' : 'consent';
    client.requestAccessToken({ prompt });
  });
}

async function ensureToken(): Promise<string> {
  if (isAuthed()) return cached!.access_token;
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
/** Legacy single-file name; kept for backward-compat reads. */
export const LEGACY_DATA_FILE = 'data.json';
/** Prefix for the new versioned data files. Format: `data-YYYYMMDD-HHMMSS.json`. */
export const DATA_FILE_PREFIX = 'data-';
export const DATA_FILE_SUFFIX = '.json';
export const META_FILE = 'meta.json';
export const PHOTOS_FOLDER = 'photos';

/** Build a versioned data filename for `now` in UTC. */
export function buildDataFilename(now: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const ymd = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}`;
  const hms = `${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  return `${DATA_FILE_PREFIX}${ymd}-${hms}${DATA_FILE_SUFFIX}`;
}

/** Recognize and parse a versioned data filename → ms epoch, or null. */
export function parseDataFilename(name: string): number | null {
  if (!name.startsWith(DATA_FILE_PREFIX) || !name.endsWith(DATA_FILE_SUFFIX))
    return null;
  const core = name.slice(DATA_FILE_PREFIX.length, -DATA_FILE_SUFFIX.length);
  const m = core.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
}
