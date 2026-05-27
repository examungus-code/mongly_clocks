import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/schema';
import { fmtRelative } from '../../utils/format';

const TILES = [
  { to: '/sell', label: 'Sell', desc: 'Record sales at the booth', icon: '🔑' },
  { to: '/catalogue', label: 'Catalogue', desc: 'Manage designs & categories', icon: '⏱' },
  { to: '/sold', label: 'Sold', desc: 'Per-product totals & export', icon: '🕰' },
  { to: '/history', label: 'History', desc: 'Every inventory adjustment', icon: '⚖' },
  { to: '/sync', label: 'Sync', desc: 'Push & pull from Drive', icon: '↻' },
  { to: '/settings', label: 'Settings', desc: 'Festivals & device', icon: '✦' },
];

export function Dashboard() {
  const session = useLiveQuery(() => db.session.get('session'));
  const festival = useLiveQuery(
    () => (session?.festival_id ? db.festivals.get(session.festival_id) : undefined),
    [session?.festival_id]
  );
  const syncMeta = useLiveQuery(() => db.sync_meta.get('sync'));

  // Today's totals (since session start, or midnight if no session)
  const since = session?.started_at ?? startOfToday();
  const todaysTx = useLiveQuery(
    () => db.transactions.where('occurred_at').above(since).toArray(),
    [since]
  );
  const itemCount = useLiveQuery(async () => {
    if (!todaysTx) return 0;
    const ids = todaysTx.map((t) => t.id);
    if (ids.length === 0) return 0;
    const lines = await db.line_items.where('transaction_id').anyOf(ids).toArray();
    return lines.reduce((sum, l) => sum + l.quantity, 0);
  }, [todaysTx]);

  const sessionActive = !!session?.started_at;

  return (
    <div className="space-y-6">
      <section className="card p-6">
        {sessionActive ? (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-brass-dark font-ui">
                Active session
              </div>
              <h2 className="text-2xl mt-1">{festival?.name ?? 'Unassigned festival'}</h2>
              <div className="text-sm text-walnut/70 mt-1">
                Started {session?.started_at ? fmtRelative(session.started_at) : ''}
              </div>
            </div>
            <div className="flex gap-6 text-right">
              <div>
                <div className="text-xs uppercase text-brass-dark font-ui">
                  Items today
                </div>
                <div className="text-3xl font-display text-walnut-dark">
                  {itemCount ?? 0}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-brass-dark font-ui">
                  Sales today
                </div>
                <div className="text-3xl font-display text-walnut-dark">
                  {todaysTx?.length ?? 0}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-2xl">Welcome back</h2>
              <p className="text-sm text-walnut/70">
                Start a session to begin recording sales at a festival.
              </p>
            </div>
            <Link to="/session/start" className="btn-primary">
              Start session
            </Link>
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {TILES.map((tile) => (
          <Link
            key={tile.to}
            to={tile.to}
            className="tile p-4 flex flex-col items-start gap-1"
          >
            <span className="text-2xl">{tile.icon}</span>
            <div className="font-display text-lg leading-tight">{tile.label}</div>
            <div className="text-xs text-walnut/60">{tile.desc}</div>
          </Link>
        ))}
      </section>

      {syncMeta && (
        <div className="text-xs text-walnut/60 text-center">
          {syncMeta.last_push_at || syncMeta.last_pull_at ? (
            <>
              Drive last synced{' '}
              {fmtRelative(
                Math.max(syncMeta.last_push_at ?? 0, syncMeta.last_pull_at ?? 0)
              )}
            </>
          ) : (
            <>Drive not yet connected</>
          )}
        </div>
      )}
    </div>
  );
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
