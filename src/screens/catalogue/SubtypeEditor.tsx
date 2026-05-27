// Shared subtype-list editor used by both ProductEditor and CategoryEditor.
// Each row is: radio (default) + name input + linked product dropdown + ✕.
// "No default (operator must pick)" sits as a separate radio below the list.

import type { ID } from '../../db/schema';

interface LinkableProduct {
  id: ID;
  name: string;
}

interface Props {
  subtypes: string[];
  defaultSubtype: string | null;
  subtypeLinks: Record<string, ID>;
  linkableProducts: LinkableProduct[];
  onSubtypesChange: (next: string[]) => void;
  onDefaultChange: (next: string | null) => void;
  onLinksChange: (next: Record<string, ID>) => void;
}

export function SubtypeEditor({
  subtypes,
  defaultSubtype,
  subtypeLinks,
  linkableProducts,
  onSubtypesChange,
  onDefaultChange,
  onLinksChange,
}: Props) {
  function setRow(i: number, value: string) {
    const oldKey = subtypes[i].trim();
    const newKey = value.trim();
    const next = [...subtypes];
    next[i] = value;
    if (defaultSubtype === oldKey) onDefaultChange(newKey);
    if (oldKey !== newKey && subtypeLinks[oldKey]) {
      const updated = { ...subtypeLinks };
      updated[newKey] = updated[oldKey];
      delete updated[oldKey];
      onLinksChange(updated);
    }
    onSubtypesChange(next);
  }

  function removeRow(i: number) {
    const removed = subtypes[i].trim();
    onSubtypesChange(subtypes.filter((_, j) => j !== i));
    if (defaultSubtype === removed) onDefaultChange(null);
    if (removed && subtypeLinks[removed]) {
      const updated = { ...subtypeLinks };
      delete updated[removed];
      onLinksChange(updated);
    }
  }

  function setLink(subtype: string, productId: string) {
    const updated = { ...subtypeLinks };
    if (productId) updated[subtype] = productId;
    else delete updated[subtype];
    onLinksChange(updated);
  }

  return (
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
              name="subtype-default"
              checked={isDefault}
              disabled={!trimmed}
              onChange={() => onDefaultChange(trimmed)}
              title="Default at sale time"
            />
            <input
              className="input !min-h-0 !py-1.5"
              placeholder="Subtype name"
              value={sub}
              onChange={(e) => setRow(i, e.target.value)}
            />
            <select
              className="input !min-h-0 !py-1.5 col-span-2 sm:col-span-1"
              value={linkedId}
              disabled={!trimmed}
              onChange={(e) => setLink(trimmed, e.target.value)}
              title="Linked component product (auto-decremented when sold)"
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
              onClick={() => removeRow(i)}
              title="Remove"
            >
              ✕
            </button>
          </li>
        );
      })}
      {subtypes.length > 0 && (
        <li>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="subtype-default"
              checked={defaultSubtype === null}
              onChange={() => onDefaultChange(null)}
            />
            <span>No default (operator must pick)</span>
          </label>
        </li>
      )}
    </ul>
  );
}
