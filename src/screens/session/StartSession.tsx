import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuid } from 'uuid';
import { db } from '../../db/schema';

export function StartSession() {
  const navigate = useNavigate();
  const festivals = useLiveQuery(
    () => db.festivals.filter((f) => !f.archived).toArray()
  );

  const [festivalId, setFestivalId] = useState<string>('');
  const [newFestival, setNewFestival] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleStart() {
    setSubmitting(true);
    let chosenFestival = festivalId;
    if (festivalId === '__new' && newFestival.trim()) {
      const id = uuid();
      const now = Date.now();
      await db.festivals.add({
        id,
        name: newFestival.trim(),
        archived: false,
        created_at: now,
        updated_at: now,
      });
      chosenFestival = id;
    }
    const startedAt = Date.now();
    await db.session.put({
      id: 'session',
      festival_id: chosenFestival || null,
      started_at: startedAt,
    });
    // History: append a SessionRecord so the catalogue's session selector
    // shows it. Active record = ended_at === null.
    await db.session_records.add({
      id: uuid(),
      festival_id: chosenFestival || null,
      started_at: startedAt,
      ended_at: null,
      created_at: startedAt,
      updated_at: startedAt,
    });
    navigate('/sell');
  }

  return (
    <div className="max-w-md mx-auto space-y-5">
      <h1 className="text-3xl">Start a session</h1>
      <p className="text-sm text-walnut/70">
        Pick the festival. This tags every sale you make until you end the
        session.
      </p>

      <div>
        <label className="label">Festival</label>
        <select
          className="input"
          value={festivalId}
          onChange={(e) => setFestivalId(e.target.value)}
        >
          <option value="">— No festival —</option>
          {festivals?.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
          <option value="__new">+ New festival…</option>
        </select>
        {festivalId === '__new' && (
          <input
            className="input mt-2"
            placeholder="Festival name"
            value={newFestival}
            onChange={(e) => setNewFestival(e.target.value)}
          />
        )}
      </div>

      <div className="flex gap-2">
        <button
          className="btn-primary flex-1"
          onClick={handleStart}
          disabled={
            submitting ||
            (festivalId === '__new' && !newFestival.trim())
          }
        >
          Start session
        </button>
      </div>
    </div>
  );
}
