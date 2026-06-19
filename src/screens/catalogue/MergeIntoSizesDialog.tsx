// One-shot data tool: collapse a set of single-size products
// (e.g. "Ring Design A - Size 5", "Size 6", "Size 7", …) into a single
// sized product. The product whose editor opened this dialog is the
// "target"; each picked product becomes one of the target's sizes,
// inheriting that product's current stock. The picked sources are then
// archived with a zeroing-out adjustment so they don't double-count.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Category, type ID, type Product } from '../../db/schema';
import {
  mergeProductsAsSizes,
  suggestSizeFromName,
} from '../../domain/catalogue';

interface Props {
  target: Product;
  onClose: () => void;
  onMerged: () => void;
}

interface SourceRow {
  product_id: ID;
  size_label: string;
}

export function MergeIntoSizesDialog({ target, onClose, onMerged }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
    return () => dialogRef.current?.close();
  }, []);

  const allProducts = useLiveQuery(() => db.products.toArray());
  const allCategories = useLiveQuery(() => db.categories.toArray());

  const candidates = useMemo(() => {
    return (allProducts ?? [])
      .filter((p) => !p.archived && p.id !== target.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allProducts, target.id]);

  // Default the target's own size label by parsing its name.
  const [targetLabel, setTargetLabel] = useState<string>(
    suggestSizeFromName(target.name)
  );

  // Selected source rows, indexed by product id for easy update.
  const [selected, setSelected] = useState<Map<ID, SourceRow>>(new Map());

  const [filterCategoryId, setFilterCategoryId] = useState<string>(
    target.category_id
  );
  const [search, setSearch] = useState('');

  function categoryPath(c_id: ID): string {
    if (!allCategories) return '';
    const byId = new Map(allCategories.map((c) => [c.id, c]));
    const parts: string[] = [];
    let cur: Category | undefined = byId.get(c_id);
    while (cur) {
      parts.unshift(cur.name);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return parts.join(' / ');
  }

  const filtered = candidates.filter((p) => {
    if (filterCategoryId && filterCategoryId !== '__all') {
      if (p.category_id !== filterCategoryId) return false;
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!p.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  function toggle(p: Product, on: boolean) {
    const next = new Map(selected);
    if (on) {
      next.set(p.id, {
        product_id: p.id,
        size_label: suggestSizeFromName(p.name),
      });
    } else {
      next.delete(p.id);
    }
    setSelected(next);
  }

  function setLabel(p_id: ID, label: string) {
    const next = new Map(selected);
    const cur = next.get(p_id);
    if (!cur) return;
    next.set(p_id, { ...cur, size_label: label });
    setSelected(next);
  }

  function selectAllVisible() {
    const next = new Map(selected);
    for (const p of filtered) {
      if (!next.has(p.id)) {
        next.set(p.id, {
          product_id: p.id,
          size_label: suggestSizeFromName(p.name),
        });
      }
    }
    setSelected(next);
  }

  function clearAll() {
    setSelected(new Map());
  }

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleMerge() {
    setSaving(true);
    setError(null);
    try {
      const sources = Array.from(selected.values());
      await mergeProductsAsSizes(target.id, targetLabel, sources);
      onMerged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const selectedCount = selected.size;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="rounded-lg p-0 bg-white text-walnut border border-brass/40 shadow-xl backdrop:bg-black/50 w-[min(720px,calc(100vw-2rem))]"
    >
      <div className="p-5 space-y-3 max-h-[85vh] overflow-y-auto">
        <header className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase text-brass-dark font-ui">
              Merge other products into
            </div>
            <h3 className="text-xl font-display">{target.name}</h3>
          </div>
          <button
            type="button"
            className="text-walnut/60 hover:text-walnut"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <p className="text-xs text-walnut/70">
          Pick the other products to absorb. Each becomes a new size on{' '}
          <strong>{target.name}</strong>, taking the source product's current
          stock as its initial inventory. The sources get archived with a
          zeroing adjustment so totals stay clean. Sale history on the
          sources stays intact.
        </p>

        <div className="card bg-brass-soft border-brass/40 p-3 space-y-2">
          <label className="block text-sm font-ui">
            Size label for <strong>{target.name}</strong>
            <input
              className="input !min-h-0 !py-1.5 mt-1 max-w-[160px]"
              placeholder="e.g. 5"
              value={targetLabel}
              onChange={(e) => setTargetLabel(e.target.value)}
            />
          </label>
          <p className="text-[11px] text-walnut/60">
            This is the size the target product itself becomes after the
            merge. The target's current stock of {target.quantity_on_hand}{' '}
            will land in this size pool.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
          <div>
            <label className="label">Category filter</label>
            <select
              className="input !min-h-0 !py-1.5"
              value={filterCategoryId}
              onChange={(e) => setFilterCategoryId(e.target.value)}
            >
              <option value="__all">All categories</option>
              {allCategories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryPath(c.id)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Search</label>
            <input
              className="input !min-h-0 !py-1.5"
              placeholder="Filter by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={selectAllVisible}
          >
            Select all visible
          </button>
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={clearAll}
          >
            Clear
          </button>
        </div>

        <div className="card divide-y divide-brass/20 max-h-[40vh] overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="p-3 text-sm text-walnut/60">
              No matching products.
            </p>
          ) : (
            filtered.map((p) => {
              const sel = selected.get(p.id);
              return (
                <label
                  key={p.id}
                  className={`flex items-center gap-3 p-2 cursor-pointer ${
                    sel ? 'bg-brass-soft/50' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={!!sel}
                    onChange={(e) => toggle(p, e.target.checked)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-ui text-sm truncate">{p.name}</div>
                    <div className="text-[11px] text-walnut/50">
                      qty {p.quantity_on_hand} · {categoryPath(p.category_id)}
                    </div>
                  </div>
                  {sel && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-walnut/60">→ size</span>
                      <input
                        className="input !min-h-0 !py-1 w-20 text-sm"
                        placeholder="?"
                        value={sel.size_label}
                        onChange={(e) => setLabel(p.id, e.target.value)}
                        onClick={(e) => e.preventDefault()}
                      />
                    </div>
                  )}
                </label>
              );
            })
          )}
        </div>

        {error && (
          <div className="text-sm text-copper bg-copper/10 border border-copper/40 rounded p-2">
            {error}
          </div>
        )}

        <footer className="flex items-center justify-between pt-3 border-t border-brass/30">
          <div className="text-sm text-walnut/70">
            {selectedCount === 0
              ? 'No sources selected yet.'
              : `${selectedCount} source${selectedCount === 1 ? '' : 's'} selected.`}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={saving || selectedCount === 0 || !targetLabel.trim()}
              onClick={handleMerge}
            >
              {saving
                ? 'Merging…'
                : `Merge ${selectedCount} into ${target.name}`}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
