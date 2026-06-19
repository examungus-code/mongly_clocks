// Category tree operations and product CRUD.
//
// Categories form an arbitrary-depth tree. Products live as children of any
// category (leaf or not). When a category is deleted, the caller picks one of:
//   - move children (sub-categories + products) to the deleted category's parent
//   - delete everything recursively
// We don't pick a default — the UI prompts.

import { v4 as uuid } from 'uuid';
import { db, type Category, type ID, type Product } from '../db/schema';

export interface CategoryNode extends Category {
  children: CategoryNode[];
  products: Product[];
}

export type TreeMode = 'active' | 'archived' | 'all';

/** Build the full tree from flat rows. O(n) — fine even at thousands. */
export function buildTree(
  categories: Category[],
  products: Product[],
  mode: TreeMode = 'active'
): CategoryNode[] {
  const nodes = new Map<ID, CategoryNode>();
  categories.forEach((c) =>
    nodes.set(c.id, { ...c, children: [], products: [] })
  );

  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    if (node.parent_id && nodes.has(node.parent_id)) {
      nodes.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  for (const p of products) {
    if (mode === 'active' && p.archived) continue;
    if (mode === 'archived' && !p.archived) continue;
    nodes.get(p.category_id)?.products.push(p);
  }

  const sortRec = (list: CategoryNode[]) => {
    list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    list.forEach((n) => {
      sortRec(n.children);
      n.products.sort(
        (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
      );
    });
  };
  sortRec(roots);
  return roots;
}

export async function createCategory(
  name: string,
  parent_id: ID | null
): Promise<ID> {
  const id = uuid();
  const now = Date.now();
  // New categories sort to the end of their parent's children.
  const siblings = await db.categories
    .where('parent_id')
    .equals(parent_id ?? 'NULL_PARENT')
    .toArray();
  const maxOrder = siblings.reduce(
    (m, c) => Math.max(m, c.sort_order),
    -1
  );
  await db.categories.add({
    id,
    name: name.trim(),
    parent_id,
    sort_order: maxOrder + 1,
    subtypes: [],
    subtype_links: {},
    created_at: now,
    updated_at: now,
  });
  return id;
}

/** Update a category's subtype config. Mirrors updateProduct's subtype logic. */
export async function updateCategorySubtypes(
  id: ID,
  input: {
    subtypes: string[];
    subtype_links: Record<string, ID>;
  }
): Promise<void> {
  const cleaned = normalizeSubtypes(input.subtypes);
  await db.categories.update(id, {
    subtypes: cleaned,
    subtype_links: pruneLinks(input.subtype_links, cleaned),
    updated_at: Date.now(),
  });
}

export async function renameCategory(id: ID, name: string): Promise<void> {
  await db.categories.update(id, { name: name.trim(), updated_at: Date.now() });
}

export async function moveCategory(
  id: ID,
  new_parent_id: ID | null
): Promise<void> {
  if (id === new_parent_id) throw new Error('cannot parent a category to itself');
  // Cycle check: walk up new_parent's ancestors; bail if we hit id.
  let cursor = new_parent_id;
  while (cursor) {
    if (cursor === id) {
      throw new Error('cannot create a cycle in the category tree');
    }
    const parent = await db.categories.get(cursor);
    cursor = parent?.parent_id ?? null;
  }
  await db.categories.update(id, {
    parent_id: new_parent_id,
    updated_at: Date.now(),
  });
}

export async function reorderCategories(
  parent_id: ID | null,
  ordered_ids: ID[]
): Promise<void> {
  await db.transaction('rw', db.categories, async () => {
    for (let i = 0; i < ordered_ids.length; i++) {
      await db.categories.update(ordered_ids[i], {
        sort_order: i,
        parent_id,
        updated_at: Date.now(),
      });
    }
  });
}

export type DeleteCategoryStrategy = 'move_to_parent' | 'delete_recursive';

export async function deleteCategory(
  id: ID,
  strategy: DeleteCategoryStrategy
): Promise<void> {
  const target = await db.categories.get(id);
  if (!target) return;

  await db.transaction(
    'rw',
    [db.categories, db.products],
    async () => {
      if (strategy === 'move_to_parent') {
        const children = await db.categories
          .where('parent_id')
          .equals(id)
          .toArray();
        const products = await db.products
          .where('category_id')
          .equals(id)
          .toArray();
        for (const c of children) {
          await db.categories.update(c.id, {
            parent_id: target.parent_id,
            updated_at: Date.now(),
          });
        }
        for (const p of products) {
          // Products can't be orphans; if there's no parent category, the user
          // can't pick "move to parent" — UI prevents this.
          if (target.parent_id === null) {
            throw new Error(
              'Cannot move products to root — categories live under categories only'
            );
          }
          await db.products.update(p.id, {
            category_id: target.parent_id,
            updated_at: Date.now(),
          });
        }
        await db.categories.delete(id);
      } else {
        // Recursive delete: collect all descendants first.
        const toDelete: ID[] = [id];
        let frontier: ID[] = [id];
        while (frontier.length > 0) {
          const next: ID[] = [];
          for (const cid of frontier) {
            const kids = await db.categories
              .where('parent_id')
              .equals(cid)
              .primaryKeys();
            next.push(...kids);
          }
          toDelete.push(...next);
          frontier = next;
        }
        // Archive products instead of hard-deleting so historical sales still
        // reference a real product row.
        const productsToArchive = await db.products
          .where('category_id')
          .anyOf(toDelete)
          .toArray();
        for (const p of productsToArchive) {
          await db.products.update(p.id, {
            archived: true,
            updated_at: Date.now(),
          });
        }
        await db.categories.bulkDelete(toDelete);
      }
    }
  );
}

// ---- Products ----

export interface NewProductInput {
  category_id: ID;
  name: string;
  description: string;
  initial_quantity: number;
  photo_file: File | null;
  subtypes: string[];
  subtype_links: Record<string, ID>;
  // Optional sized-product axis. When non-empty, the product is treated as
  // a separate-pool variant set — each size has its own stock counter,
  // and `initial_quantity` is ignored (she restocks each size separately
  // after creation).
  sizes: string[];
}

export async function createProduct(input: NewProductInput): Promise<ID> {
  const id = uuid();
  const now = Date.now();

  let photo_id: ID | null = null;
  if (input.photo_file) {
    photo_id = uuid();
    await db.photos.add({ id: photo_id, file: input.photo_file });
  }

  const siblings = await db.products
    .where('category_id')
    .equals(input.category_id)
    .toArray();
  const maxOrder = siblings.reduce((m, p) => Math.max(m, p.sort_order), -1);

  await db.transaction('rw', [db.products, db.adjustments], async () => {
    const cleanedSubtypes = normalizeSubtypes(input.subtypes);
    const cleanedSizes = normalizeSizes(input.sizes);
    // Sized products start each size at 0 — she restocks per size after
    // creation. The unsized fallback path keeps using initial_quantity.
    const sizeStock: Record<string, number> = {};
    for (const s of cleanedSizes) sizeStock[s] = 0;

    await db.products.add({
      id,
      category_id: input.category_id,
      name: input.name.trim(),
      description: input.description.trim(),
      quantity_on_hand: 0, // will be set by adjustment below
      photo_id,
      sort_order: maxOrder + 1,
      archived: false,
      subtypes: cleanedSubtypes,
      subtype_links: pruneLinks(input.subtype_links, cleanedSubtypes),
      sizes: cleanedSizes,
      size_stock: sizeStock,
      created_at: now,
      updated_at: now,
    });

    if (cleanedSizes.length === 0 && input.initial_quantity > 0) {
      await db.adjustments.add({
        id: uuid(),
        product_id: id,
        delta: input.initial_quantity,
        reason: 'restocked',
        transaction_id: null,
        note: 'Initial stock',
        occurred_at: now,
        created_at: now,
      });
      await db.products.update(id, { quantity_on_hand: input.initial_quantity });
    }
  });

  return id;
}

export interface UpdateProductInput {
  name?: string;
  description?: string;
  photo_file?: File | null; // null = clear photo, undefined = no change
  category_id?: ID;
  subtypes?: string[];
  subtype_links?: Record<string, ID>;
  /**
   * Pass the full new sizes list to update. New sizes get a zero entry in
   * size_stock; removed sizes have their stock dropped (caller is
   * responsible for warning the user if non-zero). Order is preserved.
   */
  sizes?: string[];
}

export async function updateProduct(
  id: ID,
  input: UpdateProductInput
): Promise<void> {
  const existing = await db.products.get(id);
  if (!existing) return;

  const patch: Partial<Product> = { updated_at: Date.now() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined)
    patch.description = input.description.trim();
  if (input.category_id !== undefined) patch.category_id = input.category_id;
  if (input.subtypes !== undefined)
    patch.subtypes = normalizeSubtypes(input.subtypes);
  if (input.subtype_links !== undefined) {
    // Prune links whose subtype no longer exists. Use the post-normalize
    // subtypes if the caller is also updating subtypes; otherwise fall back
    // to the existing product's subtypes.
    const subs = patch.subtypes ?? existing.subtypes ?? [];
    patch.subtype_links = pruneLinks(input.subtype_links, subs);
  }
  if (input.sizes !== undefined) {
    const cleaned = normalizeSizes(input.sizes);
    const existingStock = existing.size_stock ?? {};
    const nextStock: Record<string, number> = {};
    // Preserve any existing stock for sizes that remain; default zero for
    // new sizes. Removed sizes silently drop their stock — the UI confirms
    // this with the operator before calling update.
    for (const s of cleaned) {
      nextStock[s] = existingStock[s] ?? 0;
    }
    patch.sizes = cleaned;
    patch.size_stock = nextStock;
    // Recompute the cached total: if any sizes are defined, total =
    // sum(size_stock); otherwise leave the existing single-pool count alone.
    if (cleaned.length > 0) {
      patch.quantity_on_hand = Object.values(nextStock).reduce(
        (a, b) => a + b,
        0
      );
    }
  }

  await db.transaction('rw', [db.products, db.photos], async () => {
    if (input.photo_file !== undefined) {
      // Replace or clear photo
      if (existing.photo_id) {
        await db.photos.delete(existing.photo_id);
      }
      if (input.photo_file) {
        const new_photo_id = uuid();
        await db.photos.add({ id: new_photo_id, file: input.photo_file });
        patch.photo_id = new_photo_id;
      } else {
        patch.photo_id = null;
      }
    }
    await db.products.update(id, patch);
  });
}

export async function archiveProduct(id: ID): Promise<void> {
  await db.products.update(id, { archived: true, updated_at: Date.now() });
}

export async function unarchiveProduct(id: ID): Promise<void> {
  await db.products.update(id, { archived: false, updated_at: Date.now() });
}

/**
 * Permanently delete a product and its photo. Sales rows in History/Sold
 * that referenced this product render as "(deleted product)" afterward.
 * Subtype links from other products/categories that pointed at this one
 * are also cleaned up so they don't dangle.
 */
export async function hardDeleteProduct(id: ID): Promise<void> {
  await db.transaction(
    'rw',
    [db.products, db.categories, db.photos],
    async () => {
      const product = await db.products.get(id);
      if (!product) return;

      if (product.photo_id) {
        await db.photos.delete(product.photo_id);
      }

      // Strip any subtype_link entries pointing at this product, on both
      // other products and categories — otherwise the resolver hands sales
      // back a dead component id.
      const allProducts = await db.products.toArray();
      for (const p of allProducts) {
        const links = p.subtype_links ?? {};
        let changed = false;
        const next: Record<string, ID> = {};
        for (const [k, v] of Object.entries(links)) {
          if (v === id) {
            changed = true;
            continue;
          }
          next[k] = v;
        }
        if (changed) {
          await db.products.update(p.id, {
            subtype_links: next,
            updated_at: Date.now(),
          });
        }
      }
      const allCategories = await db.categories.toArray();
      for (const c of allCategories) {
        const links = c.subtype_links ?? {};
        let changed = false;
        const next: Record<string, ID> = {};
        for (const [k, v] of Object.entries(links)) {
          if (v === id) {
            changed = true;
            continue;
          }
          next[k] = v;
        }
        if (changed) {
          await db.categories.update(c.id, {
            subtype_links: next,
            updated_at: Date.now(),
          });
        }
      }

      await db.products.delete(id);
    }
  );
}

/** Parse a comma- or whitespace-separated size string into a clean array. */
export function parseSizesInput(raw: string): string[] {
  return normalizeSizes(raw.split(/[,\n]/));
}

/** Sizes display: a single comma+space joined string for the editor input. */
export function sizesToInput(sizes: string[]): string {
  return sizes.join(', ');
}

/** Mirror of normalizeSubtypes but for sizes. */
function normalizeSizes(sizes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of sizes) {
    const name = raw.trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Trim, drop empties, dedupe while preserving order. */
function normalizeSubtypes(subtypes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of subtypes) {
    const name = raw.trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Drop any link whose subtype name isn't in the current subtypes list. */
function pruneLinks(
  links: Record<string, ID>,
  subtypes: string[]
): Record<string, ID> {
  const allowed = new Set(subtypes);
  const out: Record<string, ID> = {};
  for (const [k, v] of Object.entries(links)) {
    if (allowed.has(k) && v) out[k] = v;
  }
  return out;
}

/** Use everywhere the UI reads a product, to handle pre-v7 rows missing fields. */
export function withSubtypeDefaults(p: Product): Product {
  return {
    ...p,
    subtypes: p.subtypes ?? [],
    subtype_links: p.subtype_links ?? {},
    sizes: p.sizes ?? [],
    size_stock: p.size_stock ?? {},
  };
}

export interface ResolvedSubtypeConfig {
  subtypes: string[];
  subtype_links: Record<string, ID>;
  /** id of the category we inherited from, or null if the product defines its own. */
  inherited_from: ID | null;
}

/**
 * Resolve a product's effective subtype configuration. If the product has any
 * subtypes of its own, those win; otherwise we walk up its category ancestors
 * and use the first ancestor that defines subtypes. If nothing is found,
 * returns an empty config.
 */
export function resolveSubtypeConfig(
  product: Pick<Product, 'category_id' | 'subtypes' | 'subtype_links'>,
  categoriesById: Map<ID, Category>
): ResolvedSubtypeConfig {
  const own = product.subtypes ?? [];
  if (own.length > 0) {
    return {
      subtypes: own,
      subtype_links: product.subtype_links ?? {},
      inherited_from: null,
    };
  }
  let catId: ID | null = product.category_id;
  while (catId) {
    const cat = categoriesById.get(catId);
    if (!cat) break;
    const catSubs = cat.subtypes ?? [];
    if (catSubs.length > 0) {
      return {
        subtypes: catSubs,
        subtype_links: cat.subtype_links ?? {},
        inherited_from: cat.id,
      };
    }
    catId = cat.parent_id;
  }
  return {
    subtypes: [],
    subtype_links: {},
    inherited_from: null,
  };
}

/** Async variant — loads categories itself. Used inside domain transactions. */
export async function resolveSubtypeConfigAsync(
  product: Pick<Product, 'category_id' | 'subtypes' | 'subtype_links'>
): Promise<ResolvedSubtypeConfig> {
  if ((product.subtypes ?? []).length > 0) {
    return {
      subtypes: product.subtypes,
      subtype_links: product.subtype_links ?? {},
      inherited_from: null,
    };
  }
  let catId: ID | null = product.category_id;
  while (catId) {
    const cat: Category | undefined = await db.categories.get(catId);
    if (!cat) break;
    const catSubs = cat.subtypes ?? [];
    if (catSubs.length > 0) {
      return {
        subtypes: catSubs,
        subtype_links: cat.subtype_links ?? {},
        inherited_from: cat.id,
      };
    }
    catId = cat.parent_id;
  }
  return {
    subtypes: [],
    subtype_links: {},
    inherited_from: null,
  };
}

export interface MergeSource {
  product_id: ID;
  /** Size label this source's stock should become on the target. */
  size_label: string;
}

/**
 * Merge a set of "source" products into a single "target" product as
 * separate-pool sizes. Each source's current quantity_on_hand becomes the
 * target's stock for the source's size_label. The sources are then
 * zeroed-out and archived; their historical sales rows stay intact and
 * continue to reference them, so business analytics for past sales are
 * preserved.
 *
 * The target absorbs its own current stock under `target_size_label`. If
 * the target already has sizes, the new sizes are appended (and duplicate
 * labels add into the existing pool rather than replacing it).
 */
export async function mergeProductsAsSizes(
  target_id: ID,
  target_size_label: string,
  sources: MergeSource[]
): Promise<void> {
  const tLabel = target_size_label.trim();
  if (!tLabel) {
    throw new Error('Enter a size label for the current product.');
  }
  if (sources.length === 0) {
    throw new Error('Pick at least one other product to merge.');
  }
  const allLabels = [tLabel, ...sources.map((s) => s.size_label.trim())];
  const seen = new Set<string>();
  for (const s of allLabels) {
    if (!s) throw new Error('Every size label must be non-empty.');
    if (seen.has(s)) throw new Error(`Duplicate size label: "${s}".`);
    seen.add(s);
  }

  await db.transaction(
    'rw',
    [db.products, db.categories, db.adjustments],
    async () => {
      const target = await db.products.get(target_id);
      if (!target) throw new Error('Target product not found.');

      // Preserve the target's existing sizes (if any) plus stock per size.
      const nextSizes: string[] = [...(target.sizes ?? [])];
      const nextStock: Record<string, number> = { ...(target.size_stock ?? {}) };

      function addToSize(label: string, qty: number) {
        if (!nextSizes.includes(label)) nextSizes.push(label);
        nextStock[label] = (nextStock[label] ?? 0) + qty;
      }

      // If the target had no sizes yet, fold its whole pool into the new
      // target_size_label. If it already had sizes, the existing pools
      // stay where they are (the new label is just an additional pool).
      if ((target.sizes ?? []).length === 0) {
        addToSize(tLabel, target.quantity_on_hand);
      } else if (!nextSizes.includes(tLabel)) {
        addToSize(tLabel, 0);
      }

      const now = Date.now();

      // Walk sources: snapshot their qty, log a merge adjustment on the
      // target, then zero-out and archive the source.
      for (const s of sources) {
        if (s.product_id === target_id) continue;
        const sourceProduct = await db.products.get(s.product_id);
        if (!sourceProduct) continue;
        const moved = sourceProduct.quantity_on_hand;
        const label = s.size_label.trim();

        if (moved !== 0) {
          await db.adjustments.add({
            id: uuid(),
            product_id: target.id,
            delta: moved,
            reason: 'manual_correction',
            transaction_id: null,
            size: label,
            note: `Merged from "${sourceProduct.name}"`,
            occurred_at: now,
            created_at: now,
          });
        }
        addToSize(label, moved);

        if (moved !== 0) {
          await db.adjustments.add({
            id: uuid(),
            product_id: sourceProduct.id,
            delta: -moved,
            reason: 'manual_correction',
            transaction_id: null,
            note: `Merged into "${target.name}"`,
            occurred_at: now,
            created_at: now,
          });
        }
        await db.products.update(sourceProduct.id, {
          quantity_on_hand: 0,
          archived: true,
          updated_at: now,
        });
      }

      const newTotal = Object.values(nextStock).reduce((a, b) => a + b, 0);
      await db.products.update(target.id, {
        sizes: nextSizes,
        size_stock: nextStock,
        quantity_on_hand: newTotal,
        updated_at: now,
      });

      // Strip any subtype_link entries on other products / categories that
      // pointed at one of the merged sources — they'd now resolve to an
      // archived product that won't be sold.
      const sourceIds = new Set(sources.map((s) => s.product_id));
      const allProducts = await db.products.toArray();
      for (const p of allProducts) {
        if (sourceIds.has(p.id) || p.id === target_id) continue;
        const links = p.subtype_links ?? {};
        let changed = false;
        const next: Record<string, ID> = {};
        for (const [k, v] of Object.entries(links)) {
          if (sourceIds.has(v)) {
            changed = true;
            continue;
          }
          next[k] = v;
        }
        if (changed) {
          await db.products.update(p.id, {
            subtype_links: next,
            updated_at: now,
          });
        }
      }
      const allCategories = await db.categories.toArray();
      for (const c of allCategories) {
        const links = c.subtype_links ?? {};
        let changed = false;
        const next: Record<string, ID> = {};
        for (const [k, v] of Object.entries(links)) {
          if (sourceIds.has(v)) {
            changed = true;
            continue;
          }
          next[k] = v;
        }
        if (changed) {
          await db.categories.update(c.id, {
            subtype_links: next,
            updated_at: now,
          });
        }
      }
    }
  );
}

/**
 * Best-effort: extract a probable size label from a product name like
 * "Ring Design A — Size 7" → "7", or "Bronze ring 9.5" → "9.5".
 */
export function suggestSizeFromName(name: string): string {
  const m = name.match(/(\d+(?:\.\d+)?)\s*$/);
  return m?.[1] ?? '';
}

export async function reorderProducts(
  category_id: ID,
  ordered_ids: ID[]
): Promise<void> {
  await db.transaction('rw', db.products, async () => {
    for (let i = 0; i < ordered_ids.length; i++) {
      await db.products.update(ordered_ids[i], {
        sort_order: i,
        category_id,
        updated_at: Date.now(),
      });
    }
  });
}
