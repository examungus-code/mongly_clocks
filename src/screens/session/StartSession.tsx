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
  const paymentTypes = useLiveQuery(
    () => db.payment_types.filter((p) => !p.archived).sortBy('sort_order')
  );

  const [festivalId, setFestivalId] = useState<string>('');
  const [newFestival, setNewFestival] = useState('');
  const [paymentTypeId, setPaymentTypeId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  // Default payment type to first available
  if (!paymentTypeId && paymentTypes?.length) {
    setPaymentTypeId(paymentTypes[0].id);
  }

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
    await db.session.put({
      id: 'session',
      festival_id: chosenFestival || null,
      default_payment_type_id: paymentTypeId,
      started_at: Date.now(),
    });
    navigate('/sell');
  }

  return (
    <div className="max-w-md mx-auto space-y-5">
      <h1 className="text-3xl">Start a session</h1>
      <p className="text-sm text-walnut/70">
        Pick the festival and default payment type. Both can be changed later.
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

      <div>
        <label className="label">Default payment type</label>
        <select
          className="input"
          value={paymentTypeId}
          onChange={(e) => setPaymentTypeId(e.target.value)}
        >
          {paymentTypes?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <button
          className="btn-primary flex-1"
          onClick={handleStart}
          disabled={
            submitting ||
            !paymentTypeId ||
            (festivalId === '__new' && !newFestival.trim())
          }
        >
          Start session
        </button>
      </div>
    </div>
  );
}
