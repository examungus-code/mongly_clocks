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

/** Build the full tree from flat rows. O(n) — fine even at thousands. */
export function buildTree(
  categories: Category[],
  products: Product[]
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
    if (p.archived) continue;
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
    created_at: now,
    updated_at: now,
  });
  return id;
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
  default_subtype: string | null;
  subtype_links: Record<string, ID>;
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
      default_subtype: input.default_subtype,
      subtype_links: pruneLinks(input.subtype_links, cleanedSubtypes),
      created_at: now,
      updated_at: now,
    });

    if (input.initial_quantity > 0) {
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
  default_subtype?: string | null;
  subtype_links?: Record<string, ID>;
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
  if (input.default_subtype !== undefined)
    patch.default_subtype = input.default_subtype;
  if (input.subtype_links !== undefined) {
    // Prune links whose subtype no longer exists. Use the post-normalize
    // subtypes if the caller is also updating subtypes; otherwise fall back
    // to the existing product's subtypes.
    const subs = patch.subtypes ?? existing.subtypes ?? [];
    patch.subtype_links = pruneLinks(input.subtype_links, subs);
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

/** Use everywhere the UI reads a product, to handle pre-v3 rows missing fields. */
export function withSubtypeDefaults(p: Product): Product {
  return {
    ...p,
    subtypes: p.subtypes ?? [],
    default_subtype: p.default_subtype ?? null,
    subtype_links: p.subtype_links ?? {},
  };
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
