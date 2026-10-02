// Data — hierarchical sold-quantity view.
//
// Categories form an indented bulleted tree; products are the leaves. Each
// row shows the name on the left and the qty sold on the right. Category
// counts are recursive sums of every product inside (including sub-categories).
// A filter at the top picks all sales, a calendar date range, or one
// festival. Next to each sold count is the average per weekend worked under
// that filter (see domain/sales-filter.ts for how days group into weekends).
// Categories and the products inside each category sort independently.
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
import { db, type Festival, type ID, type Product } from '../../db/schema';
import { type CategoryNode } from '../../domain/catalogue';
import {
  countWeekends,
  dayKey,
  parseDay,
  transactionMatches,
  type SalesFilter,
} from '../../domain/sales-filter';
import { DateRangePicker } from '../../components/DateRangePicker';
import { downloadCsv, toCsv } from '../../utils/csv-export';
import { fmtDate } from '../../utils/format';

interface SoldTotals {
  total: number;
  bySize: Map<string, number>;
}

type SortOrder = 'catalog' | 'most' | 'fewest';

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: 'catalog', label: 'Catalog order' },
  { value: 'most', label: 'Most sold first' },
  { value: 'fewest', label: 'Fewest sold first' },
];

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
  const sessions = useLiveQuery(() => db.session_records.toArray());
  const festivals = useLiveQuery(async () =>
    (await db.festivals.toArray()).sort((a, b) => a.name.localeCompare(b.name))
  );

  const [filter, setFilter] = useState<SalesFilter>({ kind: 'all' });
  const [pickingRange, setPickingRange] = useState(false);
  const [categorySort, setCategorySort] = useState<SortOrder>('catalog');
  const [productSort, setProductSort] = useState<SortOrder>('catalog');
  const [collapsed, setCollapsed] = useState<Set<ID>>(new Set());

  // soldByProduct = map of product_id -> { total, bySize } for the sales the
  // filter selects. Includes both line items (regular sales) and
  // sold_component adjustments (chains decremented because a necklace
  // they're linked to was sold).
  const soldByProduct = useMemo(() => {
    const map = new Map<ID, SoldTotals>();
    if (!transactions || !lineItems) return map;
    const txIds = new Set(
      transactions.filter((t) => transactionMatches(filter, t)).map((t) => t.id)
    );
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
      if (!txIds.has(line.transaction_id)) continue;
      bump(line.product_id, line.quantity, line.size ?? null);
    }
    for (const adj of componentAdjustments ?? []) {
      if (!adj.transaction_id) continue;
      if (!txIds.has(adj.transaction_id)) continue;
      // Components aren't sized, so no size bump.
      bump(adj.product_id, -adj.delta, null);
    }
    return map;
  }, [transactions, lineItems, componentAdjustments, filter]);

  const weekends = useMemo(
    () =>
      transactions && sessions
        ? countWeekends(filter, transactions, sessions)
        : 0,
    [transactions, sessions, filter]
  );

  // Days with any sale, marked in the calendar so festival weekends stand out.
  const saleDays = useMemo(
    () => new Set((transactions ?? []).map((t) => dayKey(t.occurred_at))),
    [transactions]
  );

  // Build the category tree in catalog order, total every category, then
  // apply the two sort orders. Sorting is stable, so ties keep catalog
  // order. We include ALL products (even archived ones with past sales) so
  // historical numbers stay accurate. Empty categories still render so the
  // structure stays predictable.
  const { tree, categoryTotals } = useMemo(() => {
    if (!categories || !products) return { tree: null, categoryTotals: null };
    const roots = buildTreeIncludingArchived(categories, products);
    const totals = new Map<ID, number>();
    const productTotal = (p: Product) => soldByProduct.get(p.id)?.total ?? 0;
    function total(node: CategoryNode): number {
      let sum = 0;
      for (const p of node.products) sum += productTotal(p);
      for (const c of node.children) sum += total(c);
      totals.set(node.id, sum);
      return sum;
    }
    roots.forEach(total);
    function sortRec(list: CategoryNode[]) {
      sortBySold(list, categorySort, (n) => totals.get(n.id) ?? 0);
      for (const n of list) {
        sortBySold(n.products, productSort, productTotal);
        sortRec(n.children);
      }
    }
    sortRec(roots);
    return { tree: roots, categoryTotals: totals };
  }, [categories, products, soldByProduct, categorySort, productSort]);

  function toggle(id: ID) {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exportCsv() {
    if (!tree) return;
    // CSV rows: full category path + product + size (when applicable) +
    // quantity (+ per-weekend average). Sized products emit one row per size
    // that had sales; everything else emits one row per product. Rows follow
    // the on-screen sort order.
    const rows: Record<string, unknown>[] = [];
    function push(path: string[], product: string, size: string, qty: number) {
      rows.push({
        category: path.join(' / '),
        product,
        size,
        quantity: qty,
        avg_per_weekend: fmtAvg(qty, weekends),
      });
    }
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
            push(here, p.name, size, qty);
          }
          // Any unsized quantity on a sized product (component decrements
          // or legacy line items) still needs to be represented.
          const sizedQty = Array.from(entry.bySize.values()).reduce(
            (a, b) => a + b,
            0
          );
          const remainder = entry.total - sizedQty;
          if (remainder !== 0) push(here, p.name, '', remainder);
        } else {
          push(here, p.name, '', entry.total);
        }
      }
      for (const c of node.children) walk(c, here);
    }
    for (const n of tree) walk(n, []);
    if (rows.length === 0) return;
    const columns = ['category', 'product', 'size', 'quantity'];
    if (weekends > 0) columns.push('avg_per_weekend');
    const csv = toCsv(rows, columns);
    downloadCsv(`clockwork-data-${filterFileTag(filter, festivals)}.csv`, csv);
  }

  if (!tree || !categoryTotals) return <div>Loading…</div>;

  const grandTotal = tree.reduce(
    (s, n) => s + (categoryTotals.get(n.id) ?? 0),
    0
  );

  const selectValue =
    filter.kind === 'festival' ? `festival:${filter.festival_id}` : filter.kind;

  function handleFilterChange(value: string) {
    if (value === 'all') setFilter({ kind: 'all' });
    else if (value === 'range') setPickingRange(true);
    else if (value.startsWith('festival:')) {
      setFilter({ kind: 'festival', festival_id: value.slice(9) });
    }
  }

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
        <label className="text-sm font-ui text-walnut/70">Show</label>
        <select
          className="input !min-h-0 !py-1.5 max-w-xs"
          value={selectValue}
          onChange={(e) => handleFilterChange(e.target.value)}
        >
          <option value="all">Total (all sessions)</option>
          <option value="range">Date range…</option>
          {festivals?.map((f) => (
            <option key={f.id} value={`festival:${f.id}`}>
              {f.name} total
            </option>
          ))}
        </select>
        {filter.kind === 'range' && (
          <button
            type="button"
            className="btn-secondary !min-h-0 !py-1.5 text-sm"
            onClick={() => setPickingRange(true)}
            title="Change dates"
          >
            {rangeLabel(filter.start, filter.end)} ✎
          </button>
        )}
        <span className="text-sm text-walnut/70 ml-auto">
          Total sold:{' '}
          <strong className="font-display text-base text-walnut">
            {grandTotal}
          </strong>
          {weekends > 0 && (
            <>
              {' '}
              over {weekends} weekend{weekends === 1 ? '' : 's'}
            </>
          )}
        </span>
      </div>

      <div className="flex items-center gap-3 flex-wrap text-sm">
        <label className="flex items-center gap-2 font-ui text-walnut/70">
          Sort categories
          <select
            className="input !min-h-0 !py-1.5 !w-auto"
            value={categorySort}
            onChange={(e) => setCategorySort(e.target.value as SortOrder)}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 font-ui text-walnut/70">
          Sort products
          <select
            className="input !min-h-0 !py-1.5 !w-auto"
            value={productSort}
            onChange={(e) => setProductSort(e.target.value as SortOrder)}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {tree.length === 0 ? (
        <p className="text-walnut/60 text-center py-8">No catalogue yet.</p>
      ) : (
        <div className="card divide-y divide-brass/20">
          <div className="grid grid-cols-[1fr_3rem_4.5rem] gap-3 px-3 py-1.5 text-[11px] uppercase font-ui text-brass-dark">
            <span />
            <span className="text-right">Sold</span>
            <span className="text-right">
              {weekends > 0 ? 'Avg / wknd' : ''}
            </span>
          </div>
          {tree.map((node) => (
            <Row
              key={node.id}
              node={node}
              depth={0}
              soldByProduct={soldByProduct}
              categoryTotals={categoryTotals}
              weekends={weekends}
              collapsed={collapsed}
              onToggle={toggle}
            />
          ))}
        </div>
      )}

      {pickingRange && (
        <DateRangePicker
          initial={filter.kind === 'range' ? filter : null}
          markedDays={saleDays}
          onApply={(start, end) => {
            setFilter({ kind: 'range', start, end });
            setPickingRange(false);
          }}
          onCancel={() => setPickingRange(false)}
        />
      )}
    </div>
  );
}

function Row({
  node,
  depth,
  soldByProduct,
  categoryTotals,
  weekends,
  collapsed,
  onToggle,
}: {
  node: CategoryNode;
  depth: number;
  soldByProduct: Map<ID, SoldTotals>;
  categoryTotals: Map<ID, number>;
  weekends: number;
  collapsed: Set<ID>;
  onToggle: (id: ID) => void;
}) {
  const total = categoryTotals.get(node.id) ?? 0;
  const isCollapsed = collapsed.has(node.id);
  const hasChildren = node.products.length > 0 || node.children.length > 0;
  const indent = depth * 16;

  return (
    <div>
      <button
        type="button"
        onClick={() => hasChildren && onToggle(node.id)}
        className={`w-full grid grid-cols-[1fr_3rem_4.5rem] gap-3 items-center px-3 py-2 text-left ${
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
        <Counts qty={total} weekends={weekends} />
      </button>
      {!isCollapsed && (
        <>
          {node.products.map((p) => (
            <ProductLine
              key={p.id}
              product={p}
              entry={soldByProduct.get(p.id)}
              weekends={weekends}
              indent={indent + 12 + 16}
            />
          ))}
          {node.children.map((child) => (
            <Row
              key={child.id}
              node={child}
              depth={depth + 1}
              soldByProduct={soldByProduct}
              categoryTotals={categoryTotals}
              weekends={weekends}
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
  weekends,
  indent,
}: {
  product: Product;
  entry: SoldTotals | undefined;
  weekends: number;
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
        className="grid grid-cols-[1fr_3rem_4.5rem] gap-3 items-center px-3 py-1.5 text-sm"
        style={{ paddingLeft: indent }}
      >
        <span className="flex items-center gap-1 truncate">
          <span className="text-walnut/30 text-xs w-3 inline-block">◦</span>
          <span className={product.archived ? 'text-walnut/50 italic' : ''}>
            {product.name}
            {product.archived && ' (archived)'}
          </span>
        </span>
        <Counts qty={qty} weekends={weekends} />
      </div>
      {sizedRows.length > 0 &&
        sizedRows.map((r) => (
          <div
            key={r.size}
            className="grid grid-cols-[1fr_3rem_4.5rem] gap-3 items-center px-3 py-1 text-xs text-walnut/70"
            style={{ paddingLeft: indent + 20 }}
          >
            <span className="truncate">size {r.size}</span>
            <Counts qty={r.qty} weekends={weekends} />
          </div>
        ))}
      {hasSizes && unsizedRemainder !== 0 && (
        <div
          className="grid grid-cols-[1fr_3rem_4.5rem] gap-3 items-center px-3 py-1 text-xs text-walnut/60 italic"
          style={{ paddingLeft: indent + 20 }}
        >
          <span className="truncate">no size recorded</span>
          <Counts qty={unsizedRemainder} weekends={weekends} />
        </div>
      )}
    </>
  );
}

/** The two right-hand number columns: qty sold and average per weekend. */
function Counts({ qty, weekends }: { qty: number; weekends: number }) {
  const tone = qty > 0 ? 'text-walnut' : 'text-walnut/30';
  return (
    <>
      <span className={`text-right tabular-nums ${tone}`}>{qty}</span>
      <span className={`text-right tabular-nums ${tone}`}>
        {weekends > 0 ? fmtAvg(qty, weekends) : ''}
      </span>
    </>
  );
}

/** Average per weekend, one decimal place, trailing ".0" dropped. */
function fmtAvg(qty: number, weekends: number): string {
  if (weekends === 0) return '';
  return String(Math.round((qty / weekends) * 10) / 10);
}

/** In-place stable sort of rows by their sold count. */
function sortBySold<T>(list: T[], order: SortOrder, sold: (x: T) => number) {
  if (order === 'most') list.sort((a, b) => sold(b) - sold(a));
  else if (order === 'fewest') list.sort((a, b) => sold(a) - sold(b));
}

function rangeLabel(start: string, end: string): string {
  const s = fmtDate(parseDay(start).getTime());
  return start === end ? s : `${s} – ${fmtDate(parseDay(end).getTime())}`;
}

function filterFileTag(
  filter: SalesFilter,
  festivals: Festival[] | undefined
): string {
  if (filter.kind === 'all') return 'all-sessions';
  if (filter.kind === 'range') {
    return filter.start === filter.end
      ? filter.start
      : `${filter.start}-to-${filter.end}`;
  }
  const name =
    festivals?.find((f) => f.id === filter.festival_id)?.name ?? 'festival';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)
    );
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
