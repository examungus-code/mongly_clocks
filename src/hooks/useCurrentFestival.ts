// The festival picked on the Sell screen — every sale is tagged with it.
//
// Stored in local prefs (not synced). A Pull from Drive replaces the festival
// list, so the stored festival can stop existing; selling with that id would
// tag sales with a festival nobody can see. When that happens we fall back to
// "No festival" and report it so the Sell screen can ask her to pick again.

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { v4 as uuid } from 'uuid';
import { db, type Festival, type ID } from '../db/schema';

export interface CurrentFestival {
  /** All festivals, by name (including archived, for labelling). */
  festivals: Festival[] | undefined;
  /** Picked festival id, or null for "No festival". */
  currentId: ID | null;
  current: Festival | undefined;
  /** True once the stored festival was found missing and reset. */
  wasReset: boolean;
  select: (id: ID | null) => Promise<void>;
  createAndSelect: (name: string) => Promise<void>;
}

export function useCurrentFestival(): CurrentFestival {
  const prefs = useLiveQuery(() => db.prefs.get('prefs'));
  const festivals = useLiveQuery(async () =>
    (await db.festivals.toArray()).sort((a, b) => a.name.localeCompare(b.name))
  );
  const [wasReset, setWasReset] = useState(false);

  const storedId = prefs?.current_festival_id ?? null;
  const current = festivals?.find((f) => f.id === storedId);
  const missing = !!festivals && storedId !== null && !current;

  useEffect(() => {
    if (!missing) return;
    setWasReset(true);
    void db.prefs.update('prefs', { current_festival_id: null });
  }, [missing]);

  async function select(id: ID | null) {
    setWasReset(false);
    await db.prefs.update('prefs', { current_festival_id: id });
  }

  async function createAndSelect(name: string) {
    const now = Date.now();
    const id = uuid();
    await db.festivals.add({
      id,
      name: name.trim(),
      archived: false,
      created_at: now,
      updated_at: now,
    });
    await select(id);
  }

  return {
    festivals,
    currentId: missing ? null : storedId,
    current,
    wasReset,
    select,
    createAndSelect,
  };
}
