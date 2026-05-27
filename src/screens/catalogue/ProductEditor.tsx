// Modal for creating/editing a product. Edit mode shows inventory adjustment
// buttons (restock, lost, broken, manual correction).

import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Product, type ID } from '../../db/schema';
import { createProduct, updateProduct } from '../../domain/catalogue';
import { recordAdjustment } from '../../domain/inventory';
import { PhotoImg } from '../../components/PhotoImg';

type Props =
  | {
      mode: 'create';
      category_id: ID;
      onClose: () => void;
      onSaved: () => void;
    }
  | {
      mode: 'edit';
      product: Product;
      onClose: () => void;
      onSaved: () => void;
      onArchive: () => void;
    };

export function ProductEditor(props: Props) {
  const isEdit = props.mode === 'edit';
  const existing = isEdit ? props.product : null;

  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [initialQty, setInitialQty] = useState('0');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoCleared, setPhotoCleared] = useState(false);
  const [saving, setSaving] = useState(false);
  // Subtypes: editable as a list of strings. Empty = no subtypes for this
  // product. default_subtype is one of the subtype strings, or null for "no
  // default (operator must pick)".
  const [subtypes, setSubtypes] = useState<string[]>(existing?.subtypes ?? []);
  const [defaultSubtype, setDefaultSubtype] = useState<string | null>(
    existing?.default_subtype ?? null
  );
  // Component links per subtype (subtype name -> linked product id). Renames
  // and removals are reflected here in the rename/delete handlers below.
  const [subtypeLinks, setSubtypeLinks] = useState<Record<string, ID>>(
    existing?.subtype_links ?? {}
  );

  // Catalogue of all other products, for the "links to" dropdown.
  const allProducts = useLiveQuery(() => db.products.toArray());
  const linkableProducts = (allProducts ?? []).filter(
    (p) => !p.archived && p.id !== existing?.id
  );

  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
    return () => dialogRef.current?.close();
  }, []);

  const recentAdjustments = useLiveQuery(
    () =>
      existing
        ? db.adjustments
            .where('product_id')
            .equals(existing.id)
            .reverse()
            .sortBy('occurred_at')
            .then((rows) => rows.slice(0, 5))
        : [],
    [existing?.id]
  );

  // The photo to display: pending upload preview > current photo > none.
  const photoPreviewUrl = photoFile ? URL.createObjectURL(photoFile) : null;
  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

  // Clean subtypes before save: trim, drop empties, dedupe (mirror normalize
  // in the domain layer so the default picker stays consistent).
  const cleanSubtypes = subtypes
    .map((s) => s.trim())
    .filter((s, i, a) => s && a.indexOf(s) === i);
  // If the default no longer matches any subtype (renamed or removed), reset.
  const effectiveDefault =
    defaultSubtype && cleanSubtypes.includes(defaultSubtype)
      ? defaultSubtype
      : null;

  // Strip links whose key isn't in the cleaned subtypes list (catches renames
  // we missed and removals).
  const effectiveLinks: Record<string, ID> = {};
  for (const s of cleanSubtypes) {
    if (subtypeLinks[s]) effectiveLinks[s] = subtypeLinks[s];
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (props.mode === 'create') {
        const qty = parseInt(initialQty, 10) || 0;
        await createProduct({
          category_id: props.category_id,
          name,
          description,
          initial_quantity: qty,
          photo_file: photoFile,
          subtypes: cleanSubtypes,
          default_subtype: effectiveDefault,
          subtype_links: effectiveLinks,
        });
      } else {
        await updateProduct(props.product.id, {
          name,
          description,
          photo_file: photoCleared ? null : (photoFile ?? undefined),
          subtypes: cleanSubtypes,
          default_subtype: effectiveDefault,
          subtype_links: effectiveLinks,
        });
      }
      props.onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function handleAdjust(delta: number, reason: 'restocked' | 'lost' | 'broken' | 'manual_correction') {
    if (!existing) return;
    const note =
      reason === 'manual_correction'
        ? prompt('Note for this correction (optional)') ?? ''
        : '';
    await recordAdjustment({
      product_id: existing.id,
      delta,
      reason,
      note,
    });
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={props.onClose}
      className="rounded-lg p-0 bg-parchment-light text-walnut border border-brass/40 shadow-xl backdrop:bg-walnut-dark/60 w-[min(640px,calc(100vw-2rem))]"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        className="p-5 space-y-4"
      >
        <header className="flex items-center justify-between">
          <h3 className="text-xl font-display">
            {isEdit ? 'Edit product' : 'New product'}
          </h3>
          <button
            type="button"
            className="text-walnut/60 hover:text-walnut"
            onClick={props.onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-4">
          <div>
            <PhotoDropzone
              previewUrl={photoPreviewUrl}
              existingPhotoId={
                photoCleared ? null : (existing?.photo_id ?? null)
              }
              onFile={(f) => {
                setPhotoFile(f);
                setPhotoCleared(false);
              }}
              onClear={() => {
                setPhotoFile(null);
                setPhotoCleared(true);
              }}
            />
          </div>
          <div className="space-y-3">
            <div>
              <label className="label">Name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label">Description (optional)</label>
              <textarea
                className="input min-h-[80px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            {!isEdit && (
              <div>
                <label className="label">Initial quantity</label>
                <input
                  className="input max-w-[160px]"
                  type="number"
                  min="0"
                  step="1"
                  value={initialQty}
                  onChange={(e) => setInitialQty(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-brass/30 pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-display text-base">Subtypes (optional)</h4>
            <button
              type="button"
              className="text-sm text-walnut/70 hover:text-walnut"
              onClick={() => setSubtypes((s) => [...s, ''])}
            >
              + Add subtype
            </button>
          </div>
          {subtypes.length === 0 ? (
            <p className="text-xs text-walnut/60">
              Leave empty if this product has no variants. Add subtypes (e.g.
              silver / gold / copper) to make the operator pick one at sale
              time. Each subtype can optionally link to another product
              (a “component”) that is auto-decremented from inventory when
              this subtype is sold — useful for things like chains.
            </p>
          ) : (
            <>
              <p className="text-xs text-walnut/60">
                Pick a default below, or leave “No default” to force the
                operator to choose at sale time. The dropdown next to each
                subtype optionally links a component product (e.g. gold
                chain) that will be deducted from inventory automatically
                when that subtype sells.
              </p>
              <ul className="space-y-2">
                {subtypes.map((sub, i) => {
                  const trimmed = sub.trim();
                  const isDefault = !!trimmed && defaultSubtype === trimmed;
                  const linkedId = trimmed ? subtypeLinks[trimmed] ?? '' : '';
                  return (
                    <li
                      key={i}
                      className="grid grid-cols-[auto_1fr_auto] sm:grid-cols-[auto_1fr_1fr_auto] gap-2 items-center"
                    >
                      <input
                        type="radio"
                        name="default-subtype"
                        checked={isDefault}
                        disabled={!trimmed}
                        onChange={() => setDefaultSubtype(trimmed)}
                        title="Default at sale time"
                      />
                      <input
                        className="input !min-h-0 !py-1.5"
                        placeholder="Subtype name"
                        value={sub}
                        onChange={(e) => {
                          const oldKey = sub.trim();
                          const newKey = e.target.value.trim();
                          const next = [...subtypes];
                          next[i] = e.target.value;
                          if (defaultSubtype === oldKey) {
                            setDefaultSubtype(newKey);
                          }
                          // Carry the existing link to the renamed key.
                          if (oldKey !== newKey && subtypeLinks[oldKey]) {
                            const updated = { ...subtypeLinks };
                            updated[newKey] = updated[oldKey];
                            delete updated[oldKey];
                            setSubtypeLinks(updated);
                          }
                          setSubtypes(next);
                        }}
                      />
                      <select
                        className="input !min-h-0 !py-1.5 col-span-2 sm:col-span-1"
                        value={linkedId}
                        disabled={!trimmed}
                        onChange={(e) => {
                          if (!trimmed) return;
                          const updated = { ...subtypeLinks };
                          if (e.target.value) {
                            updated[trimmed] = e.target.value;
                          } else {
                            delete updated[trimmed];
                          }
                          setSubtypeLinks(updated);
                        }}
                        title="Linked component product (decremented from inventory when this subtype is sold)"
                      >
                        <option value="">
                          {trimmed ? '— no linked component —' : '(name first)'}
                        </option>
                        {linkableProducts.map((p) => (
                          <option key={p.id} value={p.id}>
                            ↳ {p.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="text-copper text-sm px-1 col-start-3 sm:col-start-4"
                        onClick={() => {
                          const next = subtypes.filter((_, j) => j !== i);
                          setSubtypes(next);
                          if (defaultSubtype === sub.trim()) {
                            setDefaultSubtype(null);
                          }
                          if (sub.trim() && subtypeLinks[sub.trim()]) {
                            const updated = { ...subtypeLinks };
                            delete updated[sub.trim()];
                            setSubtypeLinks(updated);
                          }
                        }}
                        title="Remove"
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="default-subtype"
                  checked={defaultSubtype === null}
                  onChange={() => setDefaultSubtype(null)}
                />
                <span>No default (operator must pick)</span>
              </label>
            </>
          )}
        </div>

        {isEdit && existing && (
          <div className="border-t border-brass/30 pt-3 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="font-display text-base">
                Inventory · {existing.quantity_on_hand} on hand
              </h4>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  const n = parseInt(
                    prompt('How many did you make?') ?? '0',
                    10
                  );
                  if (n > 0) handleAdjust(n, 'restocked');
                }}
              >
                + Restock
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => handleAdjust(-1, 'lost')}
              >
                − Lost
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => handleAdjust(-1, 'broken')}
              >
                − Broken
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  const delta = parseInt(
                    prompt('Correction delta (e.g. -2 or 3)') ?? '',
                    10
                  );
                  if (!isNaN(delta) && delta !== 0)
                    handleAdjust(delta, 'manual_correction');
                }}
              >
                ± Manual correction
              </button>
            </div>
            {recentAdjustments && recentAdjustments.length > 0 && (
              <ul className="text-xs text-walnut/70 mt-2 space-y-0.5">
                {recentAdjustments.map((a) => (
                  <li key={a.id}>
                    {new Date(a.occurred_at).toLocaleDateString()} · {a.reason}{' '}
                    · {a.delta > 0 ? '+' : ''}
                    {a.delta}
                    {a.note ? ` · ${a.note}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <footer className="flex items-center justify-between pt-3 border-t border-brass/30">
          <div>
            {isEdit && (
              <button
                type="button"
                className="btn-danger"
                onClick={() => {
                  if (
                    confirm(
                      'Archive this product? It will be hidden from the sales screen but kept in sales history.'
                    )
                  ) {
                    (props as Extract<Props, { mode: 'edit' }>).onArchive();
                  }
                }}
              >
                Archive
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={props.onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create product'}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}

function PhotoDropzone({
  previewUrl,
  existingPhotoId,
  onFile,
  onClear,
}: {
  previewUrl: string | null;
  existingPhotoId: ID | null;
  onFile: (f: File) => void;
  onClear: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      onFile(file);
    }
  }

  return (
    <div className="space-y-2">
      <div
        className={`aspect-square rounded-md border-2 border-dashed flex items-center justify-center text-center text-xs cursor-pointer overflow-hidden
          ${dragOver ? 'border-brass bg-brass/10' : 'border-walnut/30 bg-parchment'}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : existingPhotoId ? (
          <PhotoImg
            photo_id={existingPhotoId}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-walnut/50 p-2">
            Drop photo here
            <br />
            or click to upload
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      {(previewUrl || existingPhotoId) && (
        <button
          type="button"
          className="text-xs text-copper hover:underline"
          onClick={onClear}
        >
          Remove photo
        </button>
      )}
    </div>
  );
}
