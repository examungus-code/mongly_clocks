import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/schema';
import {
  authenticate,
  connectedEmail,
  disconnect,
  isAuthed,
  isConfigured,
} from '../../sync/drive-client';
import { pushToDrive, type PushProgress } from '../../sync/push';
import {
  listDataVersions,
  pullFromDrive,
  type DataVersion,
  type PullProgress,
} from '../../sync/pull';
import { fmtDateTime, fmtRelative } from '../../utils/format';
import { Confirm } from '../../components/Confirm';

type Progress = PushProgress | PullProgress;

export function Sync() {
  const meta = useLiveQuery(() => db.sync_meta.get('sync'));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmPush, setConfirmPush] = useState(false);
  const [confirmPull, setConfirmPull] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<DataVersion | null>(
    null
  );
  const [authed, setAuthed] = useState(isAuthed());
  const [email, setEmail] = useState<string | null>(connectedEmail());
  const [versions, setVersions] = useState<DataVersion[] | null>(null);
  const [versionsLoading, setVersionsLoading] = useState(false);

  if (!isConfigured()) {
    return <UnconfiguredNotice />;
  }

  async function handleConnect() {
    try {
      await authenticate();
      setAuthed(true);
      setEmail(connectedEmail());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleDisconnect() {
    if (!confirm('Disconnect from Google? You can reconnect later.')) return;
    disconnect();
    setAuthed(false);
    setEmail(null);
    setVersions(null);
  }

  async function refreshVersions() {
    if (!authed) return;
    setVersionsLoading(true);
    try {
      const list = await listDataVersions();
      setVersions(list);
    } catch (e) {
      // Versions panel failure shouldn't block the page; surface but don't
      // crash the rest of the UI.
      setError(
        `Couldn't list versions: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setVersionsLoading(false);
    }
  }

  // Pull versions list on first connection + whenever a sync completes
  // successfully so the latest push appears at the top.
  useEffect(() => {
    if (authed && versions === null) void refreshVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  async function runPush() {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      await pushToDrive((p) => setProgress(p));
      await refreshVersions();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runPull(versionId?: string) {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      await pullFromDrive((p) => setProgress(p), versionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const lastSync = Math.max(
    meta?.last_push_at ?? 0,
    meta?.last_pull_at ?? 0
  );

  return (
    <div className="space-y-5 max-w-xl">
      <h2 className="text-2xl">Sync</h2>

      <section className="card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase text-brass-dark font-ui">
              Drive status
            </div>
            <div className="font-display text-lg">
              {meta?.last_cloud_modified_at
                ? `Cloud last updated ${fmtRelative(meta.last_cloud_modified_at)}${
                    meta.last_cloud_device_label
                      ? ` on ${meta.last_cloud_device_label}`
                      : ''
                  }`
                : 'Not yet connected'}
            </div>
            {lastSync > 0 && (
              <div className="text-xs text-walnut/60 mt-1">
                This device last {meta!.last_push_at && meta!.last_push_at === lastSync ? 'pushed' : 'pulled'}{' '}
                {fmtRelative(lastSync)}
              </div>
            )}
          </div>
          {!authed && (
            <button className="btn-secondary" onClick={handleConnect}>
              Connect to Google
            </button>
          )}
        </div>
        {email && (
          <div className="flex items-center justify-between text-xs text-walnut/70 mt-2 pt-2 border-t border-brass/20">
            <span>
              Connected as <strong>{email}</strong>
            </span>
            <button
              type="button"
              className="text-copper hover:underline"
              onClick={handleDisconnect}
            >
              Disconnect
            </button>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          className="card p-5 text-left hover:bg-parchment-dark/30 disabled:opacity-50"
          disabled={busy}
          onClick={() => setConfirmPush(true)}
        >
          <div className="font-display text-xl">↑ Push to Drive</div>
          <p className="text-sm text-walnut/70 mt-1">
            Save a new versioned snapshot of this device to Drive. Previous
            versions stay intact.
          </p>
        </button>
        <button
          className="card p-5 text-left hover:bg-parchment-dark/30 disabled:opacity-50"
          disabled={busy}
          onClick={() => setConfirmPull(true)}
        >
          <div className="font-display text-xl">↓ Pull latest</div>
          <p className="text-sm text-walnut/70 mt-1">
            Download the newest version, replacing everything on this device.
          </p>
        </button>
      </section>

      {progress && (
        <div className="card p-4">
          <div className="font-ui text-sm">{progress.message}</div>
          {progress.photo_total !== undefined && progress.photo_total > 0 && (
            <div className="mt-2 h-2 bg-parchment-dark rounded overflow-hidden">
              <div
                className="h-full bg-brass transition-all"
                style={{
                  width: `${((progress.photo_index ?? 0) / progress.photo_total) * 100}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="card p-4 border-copper bg-copper/10 text-copper">
          <strong>Sync failed:</strong> {error}
        </div>
      )}

      {authed && (
        <section className="card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg">Recent versions</h3>
            <button
              className="text-sm text-walnut/70 hover:text-walnut disabled:opacity-50"
              onClick={refreshVersions}
              disabled={busy || versionsLoading}
            >
              {versionsLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          <p className="text-xs text-walnut/60">
            Every Push saves a new snapshot here. If the latest version is bad
            or the data on this device gets corrupted, restore a prior one.
            Photos are never deleted — they stay on Drive forever.
          </p>
          {versions === null ? (
            <p className="text-sm text-walnut/60">
              {versionsLoading
                ? 'Loading versions…'
                : 'Sign in and push or pull once to populate.'}
            </p>
          ) : versions.length === 0 ? (
            <p className="text-sm text-walnut/60">
              No snapshots in the Drive folder yet.
            </p>
          ) : (
            <ul className="divide-y divide-brass/20">
              {versions.slice(0, 30).map((v, i) => (
                <li
                  key={v.id}
                  className="py-2 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="font-ui text-sm">
                      {fmtDateTime(v.timestamp_ms)}
                      {i === 0 && (
                        <span className="text-brass-dark ml-2">· latest</span>
                      )}
                      {v.legacy && (
                        <span className="text-walnut/40 ml-2 text-xs">
                          (pre-versioning)
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-walnut/50 font-mono truncate">
                      {v.name}
                    </div>
                  </div>
                  <button
                    className="text-sm text-walnut hover:text-brass-dark disabled:opacity-50"
                    disabled={busy}
                    onClick={() => setConfirmRestore(v)}
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Confirm
        open={confirmPush}
        title="Push to Drive?"
        body="This will save a new snapshot of everything currently on this device. Previous snapshots stay on Drive untouched."
        confirmLabel="Push"
        onCancel={() => setConfirmPush(false)}
        onConfirm={() => {
          setConfirmPush(false);
          runPush();
        }}
      />
      <Confirm
        open={confirmPull}
        title="Pull latest version?"
        body="This will overwrite everything on this device with the most recent cloud snapshot. Any unsynced changes on this device will be lost."
        confirmLabel="Pull latest"
        danger
        onCancel={() => setConfirmPull(false)}
        onConfirm={() => {
          setConfirmPull(false);
          runPull();
        }}
      />
      <Confirm
        open={!!confirmRestore}
        title={confirmRestore ? `Restore ${fmtDateTime(confirmRestore.timestamp_ms)}?` : ''}
        body="This will overwrite everything on this device with that snapshot. Push afterward to record it as the new latest version, otherwise the next Pull will go back to the actual latest."
        confirmLabel="Restore"
        danger
        onCancel={() => setConfirmRestore(null)}
        onConfirm={() => {
          const v = confirmRestore;
          setConfirmRestore(null);
          if (v) runPull(v.id);
        }}
      />
    </div>
  );
}

function UnconfiguredNotice() {
  return (
    <div className="space-y-4 max-w-xl">
      <h2 className="text-2xl">Sync</h2>
      <div className="card p-5 border-brass space-y-2">
        <h3 className="font-display text-lg">Drive sync not configured</h3>
        <p className="text-sm">
          This build doesn't have a Google OAuth client ID. The owner needs to
          create one in Google Cloud Console, set{' '}
          <code className="bg-parchment-dark px-1 rounded">
            VITE_GOOGLE_CLIENT_ID
          </code>{' '}
          at build time, and redeploy.
        </p>
        <p className="text-sm">
          See{' '}
          <a
            href="https://github.com/examungus-code/mongly_clocks/blob/main/SETUP_DRIVE.md"
            target="_blank"
            rel="noreferrer"
            className="text-copper underline"
          >
            SETUP_DRIVE.md
          </a>{' '}
          in the repo for the steps.
        </p>
      </div>
    </div>
  );
}
