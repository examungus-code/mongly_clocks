// Sold — hierarchical sold-quantity view.
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

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type ID } from '../../db/schema';
import { type CategoryNode } from '../../domain/catalogue';
import { downloadCsv, toCsv } from '../../utils/csv-export';

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

  // soldByProduct = map of product_id -> qty sold in the selected session
  // (or across all sessions when 'total' is selected). Includes both line
  // items (regular sales) and sold_component adjustments (chains decremented
  // because a necklace they're linked to was sold).
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
    for (const adj of componentAdjustments ?? []) {
      if (!adj.transaction_id) continue;
      if (txIds && !txIds.has(adj.transaction_id)) continue;
      // delta is negative for 'sold_component'; flip to get qty consumed.
      map.set(
        adj.product_id,
        (map.get(adj.product_id) ?? 0) + -adj.delta
      );
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

  function recursiveCount(node: CategoryNode): number {
    let total = 0;
    for (const p of node.products) total += soldByProduct.get(p.id) ?? 0;
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
    // CSV rows: full category path + product + quantity. One row per product
    // with at least one sale; categories themselves aren't emitted (they're
    // implicit in the path column).
    const rows: Record<string, unknown>[] = [];
    function walk(node: CategoryNode, path: string[]) {
      const here = [...path, node.name];
      for (const p of node.products) {
        const qty = soldByProduct.get(p.id) ?? 0;
        if (qty === 0) continue;
        rows.push({
          category: here.join(' / '),
          product: p.name,
          quantity: qty,
        });
      }
      for (const c of node.children) walk(c, here);
    }
    for (const n of tree) walk(n, []);
    if (rows.length === 0) return;
    const csv = toCsv(rows, ['category', 'product', 'quantity']);
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
    downloadCsv(`clockwork-history-${sessionTag}.csv`, csv);
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
  soldByProduct: Map<ID, number>;
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
          {node.products.map((p) => {
            const qty = soldByProduct.get(p.id) ?? 0;
            return (
              <div
                key={p.id}
                className="grid grid-cols-[1fr_auto] gap-3 items-center px-3 py-1.5 text-sm"
                style={{ paddingLeft: indent + 12 + 16 }}
              >
                <span className="flex items-center gap-1 truncate">
                  <span className="text-walnut/30 text-xs w-3 inline-block">
                    ◦
                  </span>
                  <span className={p.archived ? 'text-walnut/50 italic' : ''}>
                    {p.name}
                    {p.archived && ' (archived)'}
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
            );
          })}
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
