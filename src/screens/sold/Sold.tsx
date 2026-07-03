// Data — hierarchical sold-quantity view.
//
// Categories form an indented bulleted tree; products are the leaves. Each
// row shows the name on the left and the qty sold on the right. Category
// counts are recursive sums of every product inside (including sub-categories).
// A session dropdown at the top filters everything, or shows totals across
// all sessions.
//
// Per-product counts include both regular line-item sales AND component
// decrements via 'sold_component' adjustments — so e.g. a "silver chain"
// that's only ever consumed inside silver necklaces still shows accurate
// totals here. This is the opposite of the AdjustmentLog page, which hides
// those component decrements because they'd duplicate the necklace row.
//
// For sized products (rings, etc.) each product row expands into per-size
// breakdown rows so she can see which sizes actually moved.

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ID, type Product } from '../../db/schema';
import { type CategoryNode } from '../../domain/catalogue';
import { downloadCsv, toCsv } from '../../utils/csv-export';

interface SoldTotals {
  total: number;
  bySize: Map<string, number>;
}

export function Sold() {
  const categories = useLiveQuery(() => db.categories.toArray());
  const products = useLiveQuery(() => db.products.toArray());
  const transactions = useLiveQuery(() => db.transactions.toArray());
  const lineItems = useLiveQuery(() => db.line_items.toArray());
  // Pull sold_component adjustments separately so components consumed via
  // subtype links also count toward their product's sold total.
  const componentAdjustments = useLiveQuery(() =>
    db.adjustments.where('reason').equals('sold_component').toArray()
  );
  const sessions = useLiveQuery(() =>
    db.session_records.orderBy('started_at').reverse().toArray()
  );
  const festivals = useLiveQuery(() => db.festivals.toArray());

  const [selectedSession, setSelectedSession] = useState<string>('total');
  const [collapsed, setCollapsed] = useState<Set<ID>>(new Set());

  // soldByProduct = map of product_id -> { total, bySize } for the selected
  // session (or across all sessions when 'total' is selected). Includes both
  // line items (regular sales) and sold_component adjustments (chains
  // decremented because a necklace they're linked to was sold).
  const soldByProduct = useMemo(() => {
    const map = new Map<ID, SoldTotals>();
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
    function bump(pid: ID, qty: number, size: string | null | undefined) {
      let entry = map.get(pid);
      if (!entry) {
        entry = { total: 0, bySize: new Map() };
        map.set(pid, entry);
      }
      entry.total += qty;
      if (size) {
        entry.bySize.set(size, (entry.bySize.get(size) ?? 0) + qty);
      }
    }
    for (const line of lineItems) {
      if (txIds && !txIds.has(line.transaction_id)) continue;
      bump(line.product_id, line.quantity, line.size ?? null);
    }
    for (const adj of componentAdjustments ?? []) {
      if (!adj.transaction_id) continue;
      if (txIds && !txIds.has(adj.transaction_id)) continue;
      // Components aren't sized, so no size bump.
      bump(adj.product_id, -adj.delta, null);
    }
    return map;
  }, [transactions, lineItems, componentAdjustments, sessions, selectedSession]);

  // Build the category tree once. We include ALL products (even archived
  // ones with past sales) so historical numbers stay accurate. Empty
  // categories still render so the structure stays predictable.
  const tree = useMemo(
    () =>
      categories && products
        ? buildTreeIncludingArchived(categories, products)
        : null,
    [categories, products]
  );

  function productTotal(p_id: ID): number {
    return soldByProduct.get(p_id)?.total ?? 0;
  }

  function recursiveCount(node: CategoryNode): number {
    let total = 0;
    for (const p of node.products) total += productTotal(p.id);
    for (const c of node.children) total += recursiveCount(c);
    return total;
  }

  function toggle(id: ID) {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function sessionLabel(s: {
    festival_id: ID | null;
    started_at: number;
    ended_at: number | null;
  }): string {
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

  function exportCsv() {
    if (!tree) return;
    // CSV rows: full category path + product + size (when applicable) +
    // quantity. Sized products emit one row per size that had sales;
    // everything else emits one row per product.
    const rows: Record<string, unknown>[] = [];
    function walk(node: CategoryNode, path: string[]) {
      const here = [...path, node.name];
      for (const p of node.products) {
        const entry = soldByProduct.get(p.id);
        if (!entry || entry.total === 0) continue;
        const productSizes = p.sizes ?? [];
        if (productSizes.length > 0 && entry.bySize.size > 0) {
          // Preserve the product's declared size order, then any that
          // slipped in from historical data (e.g. renamed sizes).
          const ordered = [
            ...productSizes.filter((s) => entry.bySize.has(s)),
            ...Array.from(entry.bySize.keys()).filter(
              (s) => !productSizes.includes(s)
            ),
          ];
          for (const size of ordered) {
            const qty = entry.bySize.get(size) ?? 0;
            if (qty === 0) continue;
            rows.push({
              category: here.join(' / '),
              product: p.name,
              size,
              quantity: qty,
            });
          }
          // Any unsized quantity on a sized product (component decrements
          // or legacy line items) still needs to be represented.
          const sizedQty = Array.from(entry.bySize.values()).reduce(
            (a, b) => a + b,
            0
          );
          const remainder = entry.total - sizedQty;
          if (remainder !== 0) {
            rows.push({
              category: here.join(' / '),
              product: p.name,
              size: '',
              quantity: remainder,
            });
          }
        } else {
          rows.push({
            category: here.join(' / '),
            product: p.name,
            size: '',
            quantity: entry.total,
          });
        }
      }
      for (const c of node.children) walk(c, here);
    }
    for (const n of tree) walk(n, []);
    if (rows.length === 0) return;
    const csv = toCsv(rows, ['category', 'product', 'size', 'quantity']);
    const sessionTag =
      selectedSession === 'total'
        ? 'all-sessions'
        : sessions?.find((s) => s.id === selectedSession)
          ? new Date(
              sessions.find((s) => s.id === selectedSession)!.started_at
            )
              .toISOString()
              .slice(0, 10)
          : 'session';
    downloadCsv(`clockwork-data-${sessionTag}.csv`, csv);
  }

  if (!tree) return <div>Loading…</div>;

  const grandTotal = tree.reduce((s, n) => s + recursiveCount(n), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl">Data</h2>
        <button
          className="btn-primary"
          onClick={exportCsv}
          disabled={grandTotal === 0}
        >
          Export CSV
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm font-ui text-walnut/70">Session</label>
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
        <span className="text-sm text-walnut/70 ml-auto">
          Total sold:{' '}
          <strong className="font-display text-base text-walnut">
            {grandTotal}
          </strong>
        </span>
      </div>

      {tree.length === 0 ? (
        <p className="text-walnut/60 text-center py-8">No catalogue yet.</p>
      ) : (
        <div className="card divide-y divide-brass/20">
          {tree.map((node) => (
            <Row
              key={node.id}
              node={node}
              depth={0}
              soldByProduct={soldByProduct}
              recursiveCount={recursiveCount}
              collapsed={collapsed}
              onToggle={toggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  node,
  depth,
  soldByProduct,
  recursiveCount,
  collapsed,
  onToggle,
}: {
  node: CategoryNode;
  depth: number;
  soldByProduct: Map<ID, SoldTotals>;
  recursiveCount: (n: CategoryNode) => number;
  collapsed: Set<ID>;
  onToggle: (id: ID) => void;
}) {
  const total = recursiveCount(node);
  const isCollapsed = collapsed.has(node.id);
  const hasChildren = node.products.length > 0 || node.children.length > 0;
  const indent = depth * 16;

  return (
    <div>
      <button
        type="button"
        onClick={() => hasChildren && onToggle(node.id)}
        className={`w-full grid grid-cols-[1fr_auto] gap-3 items-center px-3 py-2 text-left ${
          hasChildren ? 'hover:bg-brass-tint cursor-pointer' : 'cursor-default'
        }`}
        style={{ paddingLeft: indent + 12 }}
      >
        <span className="flex items-center gap-1 font-ui font-medium truncate">
          <span className="text-walnut/40 text-xs w-3 inline-block">
            {hasChildren ? (isCollapsed ? '▸' : '▾') : '•'}
          </span>
          {node.name}
        </span>
        <span
          className={`text-sm tabular-nums ${
            total > 0 ? 'text-walnut' : 'text-walnut/30'
          }`}
        >
          {total}
        </span>
      </button>
      {!isCollapsed && (
        <>
          {node.products.map((p) => (
            <ProductLine
              key={p.id}
              product={p}
              entry={soldByProduct.get(p.id)}
              indent={indent + 12 + 16}
            />
          ))}
          {node.children.map((child) => (
            <Row
              key={child.id}
              node={child}
              depth={depth + 1}
              soldByProduct={soldByProduct}
              recursiveCount={recursiveCount}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
        </>
      )}
    </div>
  );
}

function ProductLine({
  product,
  entry,
  indent,
}: {
  product: Product;
  entry: SoldTotals | undefined;
  indent: number;
}) {
  const qty = entry?.total ?? 0;
  const productSizes = product.sizes ?? [];
  const hasSizes = productSizes.length > 0;
  // Only surface the per-size breakdown when the product was actually set up
  // with sizes AND at least one size row would have a non-zero count.
  const sizedRows: Array<{ size: string; qty: number }> = [];
  let unsizedRemainder = 0;
  if (entry) {
    if (hasSizes) {
      // Product's declared size order first, then any stragglers (e.g.
      // renamed sizes that still exist in old sales).
      const ordered = [
        ...productSizes.filter((s) => entry.bySize.has(s)),
        ...Array.from(entry.bySize.keys()).filter(
          (s) => !productSizes.includes(s)
        ),
      ];
      for (const s of ordered) {
        const c = entry.bySize.get(s) ?? 0;
        if (c !== 0) sizedRows.push({ size: s, qty: c });
      }
      const sizedTotal = Array.from(entry.bySize.values()).reduce(
        (a, b) => a + b,
        0
      );
      unsizedRemainder = entry.total - sizedTotal;
    }
  }

  return (
    <>
      <div
        className="grid grid-cols-[1fr_auto] gap-3 items-center px-3 py-1.5 text-sm"
        style={{ paddingLeft: indent }}
      >
        <span className="flex items-center gap-1 truncate">
          <span className="text-walnut/30 text-xs w-3 inline-block">◦</span>
          <span className={product.archived ? 'text-walnut/50 italic' : ''}>
            {product.name}
            {product.archived && ' (archived)'}
          </span>
        </span>
        <span
          className={`tabular-nums ${
            qty > 0 ? 'text-walnut' : 'text-walnut/30'
          }`}
        >
          {qty}
        </span>
      </div>
      {sizedRows.length > 0 &&
        sizedRows.map((r) => (
          <div
            key={r.size}
            className="grid grid-cols-[1fr_auto] gap-3 items-center px-3 py-1 text-xs text-walnut/70"
            style={{ paddingLeft: indent + 20 }}
          >
            <span className="truncate">size {r.size}</span>
            <span className="tabular-nums">{r.qty}</span>
          </div>
        ))}
      {hasSizes && unsizedRemainder !== 0 && (
        <div
          className="grid grid-cols-[1fr_auto] gap-3 items-center px-3 py-1 text-xs text-walnut/60 italic"
          style={{ paddingLeft: indent + 20 }}
        >
          <span className="truncate">no size recorded</span>
          <span className="tabular-nums">{unsizedRemainder}</span>
        </div>
      )}
    </>
  );
}

/**
 * Like buildTree from the domain layer, but INCLUDES archived products so
 * their historical sales still show. The catalogue editor hides archived
 * products; the history page must not.
 */
function buildTreeIncludingArchived(
  categories: import('../../db/schema').Category[],
  products: import('../../db/schema').Product[]
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
    nodes.get(p.category_id)?.products.push(p);
  }
  const sortRec = (list: CategoryNode[]) => {
    list.sort(
      (a, b) =>
        a.sort_order - b.sort_order || a.name.localeCompare(b.name)
    );
    list.forEach((n) => {
      sortRec(n.children);
      n.products.sort(
        (a, b) =>
          a.sort_order - b.sort_order || a.name.localeCompare(b.name)
      );
    });
  };
  sortRec(roots);
  return roots;
}
