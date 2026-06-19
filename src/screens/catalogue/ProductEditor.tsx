// Modal for creating/editing a product. Edit mode shows inventory adjustment
// buttons (restock, lost, broken, manual correction).

import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Product, type ID } from '../../db/schema';
import {
  createProduct,
  parseSizesInput,
  resolveSubtypeConfig,
  sizesToInput,
  updateProduct,
} from '../../domain/catalogue';
import { recordAdjustment } from '../../domain/inventory';
import { PhotoImg } from '../../components/PhotoImg';
import { SubtypeEditor } from './SubtypeEditor';

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
  // product. There are no defaults — at sale time, when a product has
  // subtypes, the operator always has to pick one.
  const [subtypes, setSubtypes] = useState<string[]>(existing?.subtypes ?? []);
  // Component links per subtype (subtype name -> linked product id). Renames
  // and removals are reflected here in the rename/delete handlers below.
  const [subtypeLinks, setSubtypeLinks] = useState<Record<string, ID>>(
    existing?.subtype_links ?? {}
  );
  // Sizes: separate-pool variant axis (rings). Editable as a comma-separated
  // string for ease of bulk entry like "5, 6, 7, 8, 9, 10".
  const [sizesText, setSizesText] = useState<string>(
    sizesToInput(existing?.sizes ?? [])
  );

  // Catalogue of all other products, for the "links to" dropdown.
  const allProducts = useLiveQuery(() => db.products.toArray());
  const linkableProducts = (allProducts ?? []).filter(
    (p) => !p.archived && p.id !== existing?.id
  );

  // Inheritance hint: if this product has no subtypes of its own, what would
  // it inherit from its category tree? Used only for display — saving with
  // an empty subtypes list keeps the inheritance active.
  const allCategories = useLiveQuery(() => db.categories.toArray());
  const probeCategoryId =
    props.mode === 'create' ? props.category_id : existing?.category_id;
  const inheritProbe =
    probeCategoryId && allCategories
      ? resolveSubtypeConfig(
          {
            category_id: probeCategoryId,
            subtypes: [],
            subtype_links: {},
          },
          new Map(allCategories.map((c) => [c.id, c]))
        )
      : null;
  const inheritedFromCategory =
    inheritProbe?.inherited_from && allCategories
      ? allCategories.find((c) => c.id === inheritProbe.inherited_from) ?? null
      : null;

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
  // in the domain layer).
  const cleanSubtypes = subtypes
    .map((s) => s.trim())
    .filter((s, i, a) => s && a.indexOf(s) === i);

  // Strip links whose key isn't in the cleaned subtypes list (catches renames
  // we missed and removals).
  const effectiveLinks: Record<string, ID> = {};
  for (const s of cleanSubtypes) {
    if (subtypeLinks[s]) effectiveLinks[s] = subtypeLinks[s];
  }

  // Parse sizes input on every render so save-time validation matches what
  // the operator sees in the editor.
  const cleanSizes = parseSizesInput(sizesText);

  // When sizes are being added or removed mid-edit, warn before save if
  // we're about to drop stock from a size that's non-zero.
  function getDroppedSizesWithStock(): string[] {
    if (props.mode !== 'edit') return [];
    const prev = props.product.sizes ?? [];
    const prevStock = props.product.size_stock ?? {};
    return prev.filter(
      (s) => !cleanSizes.includes(s) && (prevStock[s] ?? 0) !== 0
    );
  }

  async function handleSave() {
    if (!name.trim()) return;
    const dropped = getDroppedSizesWithStock();
    if (dropped.length > 0) {
      const proceed = confirm(
        `Removing these sizes will discard their on-hand stock: ${dropped.join(
          ', '
        )}. Continue?`
      );
      if (!proceed) return;
    }
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
          subtype_links: effectiveLinks,
          sizes: cleanSizes,
        });
      } else {
        await updateProduct(props.product.id, {
          name,
          description,
          photo_file: photoCleared ? null : (photoFile ?? undefined),
          subtypes: cleanSubtypes,
          subtype_links: effectiveLinks,
          sizes: cleanSizes,
        });
      }
      props.onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function handleAdjust(
    delta: number,
    reason: 'restocked' | 'lost' | 'broken' | 'manual_correction',
    size: string | null = null
  ) {
    if (!existing) return;
    const note =
      reason === 'manual_correction'
        ? prompt('Note for this correction (optional)') ?? ''
        : '';
    await recordAdjustment({
      product_id: existing.id,
      delta,
      reason,
      size,
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
            {!isEdit && cleanSizes.length === 0 && (
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
            inheritedFromCategory && inheritProbe ? (
              <div className="text-xs text-walnut/70 bg-brass-soft border border-brass/40 rounded-md px-3 py-2">
                Inheriting from <strong>{inheritedFromCategory.name}</strong>:{' '}
                {inheritProbe.subtypes.join(' / ')}. Add subtypes here to
                override.
              </div>
            ) : (
              <p className="text-xs text-walnut/60">
                Leave empty if this product has no variants. Add subtypes (e.g.
                silver / gold / copper) to make the operator pick one at sale
                time. Each subtype can optionally link to another product
                (a “component”) that is auto-decremented when this subtype is
                sold. Tip: define these on the <em>category</em> instead to
                share across all products inside.
              </p>
            )
          ) : (
            <>
              <p className="text-xs text-walnut/60">
                The operator picks one of these at sale time. The dropdown
                next to each subtype optionally links a component product
                that gets auto-deducted when that subtype sells.
              </p>
              <SubtypeEditor
                subtypes={subtypes}
                subtypeLinks={subtypeLinks}
                linkableProducts={linkableProducts}
                onSubtypesChange={setSubtypes}
                onLinksChange={setSubtypeLinks}
              />
            </>
          )}
        </div>

        <div className="border-t border-brass/30 pt-3 space-y-2">
          <h4 className="font-display text-base">Sizes (optional)</h4>
          <p className="text-xs text-walnut/60">
            For products with discrete size variants like rings, where each
            size is a distinct piece of stock. Enter as a comma-separated
            list, e.g. <code>5, 6, 7, 8, 9, 10</code>. Leave empty for an
            unsized product (the regular shared-pool behavior).
          </p>
          <input
            className="input"
            placeholder="e.g. 5, 6, 7, 8, 9, 10"
            value={sizesText}
            onChange={(e) => setSizesText(e.target.value)}
          />
          {cleanSizes.length > 0 && (
            <p className="text-xs text-walnut/50">
              Parsed sizes: {cleanSizes.join(' · ')}
            </p>
          )}
        </div>

        {isEdit && existing && (
          <div className="border-t border-brass/30 pt-3 space-y-2">
            <h4 className="font-display text-base">
              Inventory · {existing.quantity_on_hand} on hand
            </h4>
            {(existing.sizes ?? []).length === 0 ? (
              <>
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
              </>
            ) : (
              <ul className="space-y-1">
                {existing.sizes.map((s) => {
                  const stock = existing.size_stock?.[s] ?? 0;
                  return (
                    <li
                      key={s}
                      className="grid grid-cols-[80px_60px_1fr] sm:grid-cols-[120px_60px_1fr] gap-2 items-center"
                    >
                      <span className="font-ui text-sm">Size {s}</span>
                      <span className="text-sm text-walnut/70 tabular-nums">
                        {stock}
                      </span>
                      <div className="flex flex-wrap gap-1 justify-end">
                        <button
                          type="button"
                          className="btn-secondary !min-h-0 !py-1 !px-2 text-xs"
                          onClick={() => {
                            const n = parseInt(
                              prompt(`How many size ${s} did you make?`) ?? '0',
                              10
                            );
                            if (n > 0) handleAdjust(n, 'restocked', s);
                          }}
                        >
                          + Restock
                        </button>
                        <button
                          type="button"
                          className="btn-secondary !min-h-0 !py-1 !px-2 text-xs"
                          onClick={() => handleAdjust(-1, 'lost', s)}
                        >
                          − Lost
                        </button>
                        <button
                          type="button"
                          className="btn-secondary !min-h-0 !py-1 !px-2 text-xs"
                          onClick={() => handleAdjust(-1, 'broken', s)}
                        >
                          − Broken
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {recentAdjustments && recentAdjustments.length > 0 && (
              <ul className="text-xs text-walnut/70 mt-2 space-y-0.5">
                {recentAdjustments.map((a) => (
                  <li key={a.id}>
                    {new Date(a.occurred_at).toLocaleDateString()} · {a.reason}{' '}
                    {a.size && `· size ${a.size} `}
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
