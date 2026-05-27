// Modal for editing a category's subtype config. Products inside a category
// (and its sub-categories) inherit these subtypes and component links unless
// they define their own.

import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Category, type ID } from '../../db/schema';
import { updateCategorySubtypes } from '../../domain/catalogue';
import { SubtypeEditor } from './SubtypeEditor';

interface Props {
  category: Category;
  onClose: () => void;
}

export function CategoryEditor({ category, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
    return () => dialogRef.current?.close();
  }, []);

  const [subtypes, setSubtypes] = useState<string[]>(category.subtypes ?? []);
  const [defaultSubtype, setDefaultSubtype] = useState<string | null>(
    category.default_subtype ?? null
  );
  const [subtypeLinks, setSubtypeLinks] = useState<Record<string, ID>>(
    category.subtype_links ?? {}
  );
  const [saving, setSaving] = useState(false);

  const allProducts = useLiveQuery(() => db.products.toArray());
  const linkableProducts = (allProducts ?? []).filter((p) => !p.archived);

  async function handleSave() {
    setSaving(true);
    try {
      await updateCategorySubtypes(category.id, {
        subtypes,
        default_subtype: defaultSubtype,
        subtype_links: subtypeLinks,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="rounded-lg p-0 bg-white text-walnut border border-brass/40 shadow-xl backdrop:bg-black/50 w-[min(640px,calc(100vw-2rem))]"
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
          <div>
            <div className="text-xs uppercase text-brass-dark font-ui">
              Category subtypes
            </div>
            <h3 className="text-xl font-display">{category.name}</h3>
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
          Every product in this category (and its sub-categories) will inherit
          these subtypes, the default, and any linked components — unless the
          product defines its own subtypes, in which case its config wins.
          Leave empty to remove inheritance.
        </p>

        <div className="flex items-center justify-between">
          <h4 className="font-display text-base">Subtypes</h4>
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
            Nothing defined yet. Add subtypes (e.g. silver / gold / copper) to
            make every product in this category use them by default.
          </p>
        ) : (
          <SubtypeEditor
            subtypes={subtypes}
            defaultSubtype={defaultSubtype}
            subtypeLinks={subtypeLinks}
            linkableProducts={linkableProducts}
            onSubtypesChange={setSubtypes}
            onDefaultChange={setDefaultSubtype}
            onLinksChange={setSubtypeLinks}
          />
        )}

        <footer className="flex items-center justify-end gap-2 pt-3 border-t border-brass/30">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
