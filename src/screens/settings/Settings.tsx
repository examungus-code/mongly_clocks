import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuid } from 'uuid';
import { db } from '../../db/schema';

export function Settings() {
  const syncMeta = useLiveQuery(() => db.sync_meta.get('sync'));
  const festivals = useLiveQuery(() => db.festivals.toArray());
  const prefs = useLiveQuery(() => db.prefs.get('prefs'));

  const [newFest, setNewFest] = useState('');

  async function addFestival() {
    if (!newFest.trim()) return;
    const now = Date.now();
    await db.festivals.add({
      id: uuid(),
      name: newFest.trim(),
      archived: false,
      created_at: now,
      updated_at: now,
    });
    setNewFest('');
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-2xl">Settings</h2>

      <section className="card p-4">
        <h3 className="font-display text-lg mb-2">This device</h3>
        <label className="label">Device label (shown in sync indicator)</label>
        <input
          className="input max-w-xs"
          value={syncMeta?.device_label ?? ''}
          onChange={(e) =>
            db.sync_meta.update('sync', { device_label: e.target.value })
          }
        />
      </section>

      <section className="card p-4">
        <h3 className="font-display text-lg mb-2">Sell behavior</h3>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 cursor-pointer"
            checked={prefs?.return_to_top_after_sale ?? false}
            onChange={(e) =>
              db.prefs.update('prefs', {
                return_to_top_after_sale: e.target.checked,
              })
            }
          />
          <span className="text-sm">
            <strong>Return to top level after each sale.</strong>
            <span className="block text-walnut/60 mt-1">
              When on, the Sell screen jumps back to the top-level category
              list every time you record a sale. When off (default), it
              stays in the current category so you can sell several of the
              same kind in a row.
            </span>
          </span>
        </label>
      </section>

      <section className="card p-4">
        <h3 className="font-display text-lg mb-2">Festivals</h3>
        <ul className="space-y-1 mb-3">
          {festivals?.map((f) => (
            <li
              key={f.id}
              className={`flex items-center justify-between gap-2 ${
                f.archived ? 'opacity-50' : ''
              }`}
            >
              <span>{f.name}</span>
              <div className="flex gap-2">
                <button
                  className="text-xs text-walnut/60 hover:underline"
                  onClick={async () => {
                    const name = prompt('Rename festival', f.name)?.trim();
                    if (name)
                      await db.festivals.update(f.id, {
                        name,
                        updated_at: Date.now(),
                      });
                  }}
                >
                  Rename
                </button>
                <button
                  className="text-xs text-copper hover:underline"
                  onClick={() =>
                    db.festivals.update(f.id, {
                      archived: !f.archived,
                      updated_at: Date.now(),
                    })
                  }
                >
                  {f.archived ? 'Unarchive' : 'Archive'}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            className="input"
            placeholder="New festival name"
            value={newFest}
            onChange={(e) => setNewFest(e.target.value)}
          />
          <button className="btn-primary" onClick={addFestival}>
            Add
          </button>
        </div>
      </section>

      <section className="card p-4 text-xs text-walnut/60">
        <p>
          Clockwork Traveler · offline-first inventory · v0.2.0
        </p>
      </section>
    </div>
  );
}
