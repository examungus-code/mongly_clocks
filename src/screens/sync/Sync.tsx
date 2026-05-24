import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/schema';
import { authenticate, isAuthed, isConfigured } from '../../sync/drive-client';
import { pushToDrive, type PushProgress } from '../../sync/push';
import { pullFromDrive, type PullProgress } from '../../sync/pull';
import { fmtRelative } from '../../utils/format';
import { Confirm } from '../../components/Confirm';

type Progress = PushProgress | PullProgress;

export function Sync() {
  const meta = useLiveQuery(() => db.sync_meta.get('sync'));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmPush, setConfirmPush] = useState(false);
  const [confirmPull, setConfirmPull] = useState(false);
  const [authed, setAuthed] = useState(isAuthed());

  if (!isConfigured()) {
    return <UnconfiguredNotice />;
  }

  async function handleConnect() {
    try {
      await authenticate();
      setAuthed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runPush() {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      await pushToDrive((p) => setProgress(p));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runPull() {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      await pullFromDrive((p) => setProgress(p));
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
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          className="card p-5 text-left hover:bg-parchment-dark/30 disabled:opacity-50"
          disabled={busy}
          onClick={() => setConfirmPush(true)}
        >
          <div className="font-display text-xl">↑ Push to Drive</div>
          <p className="text-sm text-walnut/70 mt-1">
            Upload everything on this device to your Drive, overwriting the
            cloud copy.
          </p>
        </button>
        <button
          className="card p-5 text-left hover:bg-parchment-dark/30 disabled:opacity-50"
          disabled={busy}
          onClick={() => setConfirmPull(true)}
        >
          <div className="font-display text-xl">↓ Pull from Drive</div>
          <p className="text-sm text-walnut/70 mt-1">
            Download the cloud copy, replacing everything on this device.
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

      <Confirm
        open={confirmPush}
        title="Push to Drive?"
        body="This will overwrite the cloud copy with everything currently on this device. The cloud will match this device exactly after."
        confirmLabel="Push"
        onCancel={() => setConfirmPush(false)}
        onConfirm={() => {
          setConfirmPush(false);
          runPush();
        }}
      />
      <Confirm
        open={confirmPull}
        title="Pull from Drive?"
        body="This will overwrite everything on this device with the cloud copy. Any unsynced changes on this device will be lost."
        confirmLabel="Pull"
        danger
        onCancel={() => setConfirmPull(false)}
        onConfirm={() => {
          setConfirmPull(false);
          runPull();
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
