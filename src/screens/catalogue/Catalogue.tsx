// Catalogue screen — desktop-primary.
//
// Layout: left pane is the category tree, right pane is the products in the
// currently selected category. Drag-and-drop:
//   - drag a category row above/below another to reorder within siblings
//   - drag a category row ONTO another to make it a child
//   - drag a product card ONTO a category to move the product
//   - drag a product card above/below another to reorder within the category
// Cycles are blocked at the domain layer (moveCategory throws).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  DndContext,
  type DragEndEvent,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { db, type Category, type ID, type Product } from '../../db/schema';
import {
  buildTree,
  createCategory,
  createProduct,
  deleteCategory,
  hardDeleteProduct,
  moveCategory,
  renameCategory,
  reorderCategories,
  reorderProducts,
  unarchiveProduct,
  updateProduct,
  archiveProduct,
  type CategoryNode,
  type DeleteCategoryStrategy,
} from '../../domain/catalogue';
import { PhotoImg } from '../../components/PhotoImg';
import { Confirm } from '../../components/Confirm';
import { ProductEditor } from './ProductEditor';
import { CategoryEditor } from './CategoryEditor';

export function Catalogue() {
  const categories = useLiveQuery(() => db.categories.toArray());
  const products = useLiveQuery(() => db.products.toArray());
  const [showArchived, setShowArchived] = useState(false);
  const tree =
    categories && products
      ? buildTree(categories, products, showArchived ? 'archived' : 'active')
      : null;

  // Session selector + per-product sold counts. 'total' = all sessions.
  const sessions = useLiveQuery(() =>
    db.session_records.orderBy('started_at').reverse().toArray()
  );
  const festivals = useLiveQuery(() => db.festivals.toArray());
  const transactions = useLiveQuery(() => db.transactions.toArray());
  const lineItems = useLiveQuery(() => db.line_items.toArray());
  const [selectedSession, setSelectedSession] = useState<string>('total');

  // Map<product_id, qty sold> for the currently-selected session (or all
  // sessions if 'total'). Recomputed any time the inputs change.
  const soldByProduct = useMemo(() => {
    const map = new Map<ID, number>();
    if (!transactions || !lineItems) return map;
    let txIds: Set<ID> | null = null;
    if (selectedSession !== 'total') {
      const session = sessions?.find((s) => s.id === selectedSession);
      if (!session) return map;
      const start = session.started_at;
      const end = session.ended_at ?? Infinity;
      txIds = new Set(
        transactions
          .filter((t) => t.occurred_at >= start && t.occurred_at <= end)
          .map((t) => t.id)
      );
    }
    for (const line of lineItems) {
      if (txIds && !txIds.has(line.transaction_id)) continue;
      map.set(
        line.product_id,
        (map.get(line.product_id) ?? 0) + line.quantity
      );
    }
    return map;
  }, [transactions, lineItems, sessions, selectedSession]);

  const [selectedCat, setSelectedCat] = useState<ID | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [newProductInCat, setNewProductInCat] = useState<ID | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Category | null>(null);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<Product | null>(
    null
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const selectedNode = tree ? findNode(tree, selectedCat) : null;

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const aData = active.data.current as DragData | undefined;
    const oData = over.data.current as DropData | undefined;
    if (!aData || !oData) return;

    try {
      if (aData.type === 'category') {
        if (oData.type === 'category-into') {
          if (aData.id === oData.id) return;
          await moveCategory(aData.id, oData.id);
        } else if (oData.type === 'category-before') {
          // Insert before target → same parent as target, reorder
          const target = await db.categories.get(oData.id);
          if (!target || target.id === aData.id) return;
          await moveCategory(aData.id, target.parent_id);
          await reorderToPosition(
            target.parent_id,
            aData.id,
            target.id,
            'before'
          );
        } else if (oData.type === 'root-into') {
          await moveCategory(aData.id, null);
        }
      } else if (aData.type === 'product') {
        if (oData.type === 'category-into') {
          await updateProduct(aData.id, { category_id: oData.id });
        } else if (oData.type === 'product-before') {
          const target = await db.products.get(oData.id);
          if (!target || target.id === aData.id) return;
          await updateProduct(aData.id, { category_id: target.category_id });
          const siblings = (
            await db.products.where('category_id').equals(target.category_id).toArray()
          )
            .filter((p) => !p.archived)
            .sort((a, b) => a.sort_order - b.sort_order);
          const ids = siblings.map((p) => p.id).filter((id) => id !== aData.id);
          const targetIdx = ids.indexOf(target.id);
          ids.splice(targetIdx, 0, aData.id);
          await reorderProducts(target.category_id, ids);
        }
      }
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Move failed');
    }
  }

  if (!tree) return <div>Loading…</div>;

  function sessionLabel(s: { festival_id: ID | null; started_at: number; ended_at: number | null }): string {
    const festName = s.festival_id
      ? festivals?.find((f) => f.id === s.festival_id)?.name ?? '—'
      : '—';
    const d = new Date(s.started_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const suffix = s.ended_at === null ? ' · active' : '';
    return `${festName} · ${d}${suffix}`;
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <label className="text-sm font-ui text-walnut/70">
          Session
        </label>
        <select
          className="input !min-h-0 !py-1.5 max-w-xs"
          value={selectedSession}
          onChange={(e) => setSelectedSession(e.target.value)}
        >
          <option value="total">Total (all sessions)</option>
          {sessions?.map((s) => (
            <option key={s.id} value={s.id}>
              {sessionLabel(s)}
            </option>
          ))}
        </select>
        <span className="text-xs text-walnut/60 hidden sm:inline">
          Sold counts on each product reflect this selection.
        </span>
        <label
          className={`ml-auto flex items-center gap-2 text-sm font-ui cursor-pointer select-none px-2 py-1 rounded ${
            showArchived ? 'bg-brass-soft border border-brass/40' : ''
          }`}
        >
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="cursor-pointer"
          />
          Show archived
        </label>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4 min-h-[60vh]">
        <aside className="card p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display text-lg">Categories</h3>
            <button
              className="btn-ghost px-2 py-1 text-sm"
              onClick={async () => {
                const name = prompt('New category name')?.trim();
                if (name) {
                  const id = await createCategory(name, null);
                  setSelectedCat(id);
                }
              }}
              title="Add root category"
            >
              + Add
            </button>
          </div>
          <RootDropZone />
          {tree.length === 0 ? (
            <p className="text-sm text-walnut/60 py-4 text-center">
              No categories yet. Click + Add to create your first one.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {tree.map((node) => (
                <TreeRow
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedId={selectedCat}
                  onSelect={setSelectedCat}
                  onRename={async (id) => {
                    const cur = await db.categories.get(id);
                    const name = prompt('Rename category', cur?.name)?.trim();
                    if (name) await renameCategory(id, name);
                  }}
                  onAddChild={async (parent_id) => {
                    const name = prompt('New sub-category name')?.trim();
                    if (name) {
                      const id = await createCategory(name, parent_id);
                      setSelectedCat(id);
                    }
                  }}
                  onEditSubtypes={(cat) => setEditingCategory(cat)}
                  onDelete={(cat) => setPendingDelete(cat)}
                />
              ))}
            </ul>
          )}
        </aside>

        <section className="card p-4">
          {selectedNode ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-xs uppercase text-brass-dark font-ui">
                    Category
                  </div>
                  <h2 className="text-2xl">{selectedNode.name}</h2>
                </div>
                <button
                  className="btn-primary"
                  onClick={() => setNewProductInCat(selectedNode.id)}
                >
                  + Add product
                </button>
              </div>
              {selectedNode.products.length === 0 ? (
                <p className="text-sm text-walnut/60 py-8 text-center">
                  {showArchived
                    ? 'No archived products in this category.'
                    : 'No products in this category yet.'}
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {selectedNode.products.map((p) => (
                    <ProductCard
                      key={p.id}
                      product={p}
                      sold={soldByProduct.get(p.id) ?? 0}
                      onClick={() => setEditingProduct(p)}
                      archivedMode={showArchived}
                      onUnarchive={
                        showArchived
                          ? () => void unarchiveProduct(p.id)
                          : undefined
                      }
                      onHardDelete={
                        showArchived
                          ? () => setHardDeleteTarget(p)
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-walnut/60 text-center py-12">
              Select a category from the tree to view its products.
            </div>
          )}
        </section>
      </div>

      {newProductInCat && (
        <ProductEditor
          mode="create"
          category_id={newProductInCat}
          onClose={() => setNewProductInCat(null)}
          onSaved={() => setNewProductInCat(null)}
        />
      )}
      {editingProduct && (
        <ProductEditor
          mode="edit"
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onSaved={() => setEditingProduct(null)}
          onArchive={async () => {
            await archiveProduct(editingProduct.id);
            setEditingProduct(null);
          }}
        />
      )}
      {editingCategory && (
        <CategoryEditor
          category={editingCategory}
          onClose={() => setEditingCategory(null)}
        />
      )}
      {pendingDelete && (
        <DeleteCategoryDialog
          category={pendingDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
      <Confirm
        open={!!hardDeleteTarget}
        title={
          hardDeleteTarget
            ? `Delete "${hardDeleteTarget.name}" forever?`
            : ''
        }
        body={
          <div className="space-y-2">
            <p>
              The product and its photo will be permanently removed. Any
              past sales of it will continue to exist in history but will
              show as <em>(deleted product)</em>.
            </p>
            <p>This can't be undone.</p>
          </div>
        }
        confirmLabel="Delete forever"
        danger
        onCancel={() => setHardDeleteTarget(null)}
        onConfirm={async () => {
          const p = hardDeleteTarget;
          setHardDeleteTarget(null);
          if (p) await hardDeleteProduct(p.id);
        }}
      />
    </DndContext>
  );
}

// ---- Tree row ----

interface DragData {
  type: 'category' | 'product';
  id: ID;
}
interface DropData {
  type: 'category-into' | 'category-before' | 'product-before' | 'root-into';
  id: ID;
}

function TreeRow({
  node,
  depth,
  selectedId,
  onSelect,
  onRename,
  onAddChild,
  onEditSubtypes,
  onDelete,
}: {
  node: CategoryNode;
  depth: number;
  selectedId: ID | null;
  onSelect: (id: ID) => void;
  onRename: (id: ID) => void;
  onAddChild: (parent_id: ID) => void;
  onEditSubtypes: (cat: Category) => void;
  onDelete: (cat: Category) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({
    id: `cat-drag-${node.id}`,
    data: { type: 'category', id: node.id } satisfies DragData,
  });
  const { setNodeRef: setIntoRef, isOver: isOverInto } = useDroppable({
    id: `cat-into-${node.id}`,
    data: { type: 'category-into', id: node.id } satisfies DropData,
  });
  const { setNodeRef: setBeforeRef, isOver: isOverBefore } = useDroppable({
    id: `cat-before-${node.id}`,
    data: { type: 'category-before', id: node.id } satisfies DropData,
  });

  return (
    <li>
      <div
        ref={setBeforeRef}
        className={`h-1.5 -mb-1 rounded ${
          isOverBefore ? 'bg-brass' : ''
        }`}
      />
      <div
        ref={(el) => {
          setDragRef(el);
          setIntoRef(el);
        }}
        {...attributes}
        {...listeners}
        onClick={() => onSelect(node.id)}
        className={`group flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer
          ${selectedId === node.id ? 'bg-brass/20 text-walnut-dark' : 'hover:bg-parchment-dark'}
          ${isDragging ? 'opacity-40' : ''}
          ${isOverInto ? 'ring-2 ring-brass' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {node.children.length > 0 ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="w-4 text-walnut/60 text-xs"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <span className="flex-1 text-sm font-ui truncate">{node.name}</span>
        <span className="text-xs text-walnut/40">
          {countLeaves(node)}
        </span>
        <CategoryMenu
          onRename={() => onRename(node.id)}
          onAddChild={() => onAddChild(node.id)}
          onEditSubtypes={() => onEditSubtypes(node)}
          onDelete={() => onDelete(node)}
        />
      </div>
      {expanded && node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              onRename={onRename}
              onAddChild={onAddChild}
              onEditSubtypes={onEditSubtypes}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function CategoryMenu({
  onRename,
  onAddChild,
  onEditSubtypes,
  onDelete,
}: {
  onRename: () => void;
  onAddChild: () => void;
  onEditSubtypes: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on any pointer activity outside the menu's own subtree. mousedown +
  // touchstart cover desktop and touch; we listen on capture so we can react
  // before child click handlers, and Escape closes from keyboards.
  useEffect(() => {
    if (!open) return;
    function handleOutside(e: Event) {
      if (
        rootRef.current &&
        !rootRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside, true);
    document.addEventListener('touchstart', handleOutside, true);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
      document.removeEventListener('touchstart', handleOutside, true);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        // Keep the trigger visible whenever the menu is open so it doesn't
        // disappear out from under the user's finger on touch devices.
        className={`px-1 text-walnut/60 ${
          open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        onClick={() => setOpen((v) => !v)}
        title="Actions"
        onPointerDown={(e) => e.stopPropagation()}
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 bg-parchment-light border border-brass/40 rounded shadow-md min-w-[140px] text-sm">
          <button
            className="block w-full text-left px-3 py-1.5 hover:bg-parchment-dark"
            onClick={() => {
              setOpen(false);
              onAddChild();
            }}
          >
            + Add sub-category
          </button>
          <button
            className="block w-full text-left px-3 py-1.5 hover:bg-parchment-dark"
            onClick={() => {
              setOpen(false);
              onRename();
            }}
          >
            Rename
          </button>
          <button
            className="block w-full text-left px-3 py-1.5 hover:bg-parchment-dark"
            onClick={() => {
              setOpen(false);
              onEditSubtypes();
            }}
          >
            Edit subtypes
          </button>
          <button
            className="block w-full text-left px-3 py-1.5 text-copper hover:bg-parchment-dark"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function RootDropZone() {
  // Root drop zone is invisible until a drag is active — implemented as a thin
  // sentinel at the top so dropping a category there makes it a root sibling.
  const { setNodeRef, isOver } = useDroppable({
    id: 'root-drop',
    data: { type: 'root-into', id: '__root__' } satisfies DropData,
  });
  return (
    <div
      ref={setNodeRef}
      className={`h-1 mb-1 rounded ${isOver ? 'bg-brass' : ''}`}
    />
  );
}

function ProductCard({
  product,
  sold,
  onClick,
  archivedMode,
  onUnarchive,
  onHardDelete,
}: {
  product: Product;
  sold: number;
  onClick: () => void;
  archivedMode?: boolean;
  onUnarchive?: () => void;
  onHardDelete?: () => void;
}) {
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({
    id: `prod-drag-${product.id}`,
    data: { type: 'product', id: product.id } satisfies DragData,
  });
  const { setNodeRef: setBeforeRef, isOver } = useDroppable({
    id: `prod-before-${product.id}`,
    data: { type: 'product-before', id: product.id } satisfies DropData,
  });

  return (
    <div ref={setBeforeRef} className={`relative ${isOver ? 'ring-2 ring-brass rounded-lg' : ''}`}>
      <div
        ref={setDragRef}
        {...attributes}
        {...listeners}
        onClick={onClick}
        className={`tile p-2 ${isDragging ? 'opacity-40' : ''} ${
          archivedMode ? 'opacity-70' : ''
        }`}
      >
        <PhotoImg
          photo_id={product.photo_id}
          alt={product.name}
          className="w-full aspect-square object-cover rounded-md grayscale-[40%]"
        />
        <div className="mt-2 text-sm font-ui font-medium truncate">
          {product.name}
        </div>
        <div className="flex justify-between text-xs text-walnut/60">
          <span>sold {sold}</span>
          <span>qty {product.quantity_on_hand}</span>
        </div>
        {archivedMode && (
          <div className="mt-2 flex gap-2 text-xs">
            <button
              type="button"
              className="text-walnut/70 hover:text-walnut underline"
              onClick={(e) => {
                e.stopPropagation();
                onUnarchive?.();
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              Unarchive
            </button>
            <button
              type="button"
              className="text-copper hover:text-copper-light underline ml-auto"
              onClick={(e) => {
                e.stopPropagation();
                onHardDelete?.();
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              Delete forever
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DeleteCategoryDialog({
  category,
  onClose,
}: {
  category: Category;
  onClose: () => void;
}) {
  const [strategy, setStrategy] = useState<DeleteCategoryStrategy>(
    category.parent_id ? 'move_to_parent' : 'delete_recursive'
  );
  return (
    <Confirm
      open
      title={`Delete "${category.name}"?`}
      body={
        <div className="space-y-2">
          <p>What should happen to the contents?</p>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="strategy"
              checked={strategy === 'move_to_parent'}
              onChange={() => setStrategy('move_to_parent')}
              disabled={!category.parent_id}
            />
            <span>
              Move sub-categories and products to parent category
              {!category.parent_id && ' (no parent — not available)'}
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="strategy"
              checked={strategy === 'delete_recursive'}
              onChange={() => setStrategy('delete_recursive')}
            />
            <span>Delete category tree and archive all products inside</span>
          </label>
        </div>
      }
      danger
      confirmLabel="Delete"
      onCancel={onClose}
      onConfirm={async () => {
        await deleteCategory(category.id, strategy);
        onClose();
      }}
    />
  );
}

// ---- Helpers ----

function findNode(tree: CategoryNode[], id: ID | null): CategoryNode | null {
  if (!id) return null;
  for (const n of tree) {
    if (n.id === id) return n;
    const sub = findNode(n.children, id);
    if (sub) return sub;
  }
  return null;
}

function countLeaves(node: CategoryNode): number {
  let total = node.products.length;
  for (const c of node.children) total += countLeaves(c);
  return total;
}

async function reorderToPosition(
  parent_id: ID | null,
  moving_id: ID,
  target_id: ID,
  pos: 'before'
): Promise<void> {
  const siblings = await db.categories
    .where('parent_id')
    .equals(parent_id ?? 'NULL_PARENT')
    .toArray();
  const ids = siblings
    .filter((c) => c.id !== moving_id)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => c.id);
  const idx = ids.indexOf(target_id);
  const insertAt = pos === 'before' ? idx : idx + 1;
  ids.splice(insertAt, 0, moving_id);
  // Dexie's where('parent_id').equals(null) doesn't match nulls; we used a
  // sentinel above, but here we need the actual stored parent_id.
  await reorderCategories(parent_id, ids);
}

// Reuse imports to silence unused warnings if any drift
void createProduct;
