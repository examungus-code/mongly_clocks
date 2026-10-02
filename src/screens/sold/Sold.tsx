// Data — hierarchical sold-quantity view.
//
// Categories form an indented bulleted tree; products are the leaves. Each
// row shows the name on the left and the qty sold on the right. Category
// counts are recursive sums of every product inside (including sub-categories).
// Two independent filters at the top combine: a festival (or all) and a
// calendar date range (or all dates). Next to each sold count is the average
// per weekend worked under those filters (see domain/sales-filter.ts for how
// days group into weekends).
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
  listWeekends,
  dayKey,
  parseDay,
  transactionMatches,
  type SalesFilter,
} from '../../domain/sales-filter';
import { DateRangePicker } from '../../components/DateRangePicker';
import { WeekendsDialog } from './WeekendsDialog';
import { downloadCsv, toCsv } from '../../utils/csv-export';
import { fmtDate } from '../../utils/format';

interface SoldTotals {
  total: number;
  bySize: Map<string, number>;
}

type SortOrder = 'catalog' | 'most' | 'fewest';

// 'none' drops the category rows and lists every product in one flat list,
// ordered by the product sort.
type CategorySortOrder = SortOrder | 'none';

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: 'catalog', label: 'Catalog order' },
  { value: 'most', label: 'Most sold first' },
  { value: 'fewest', label: 'Fewest sold first' },
];

const CATEGORY_SORT_OPTIONS: { value: CategorySortOrder; label: string }[] = [
  ...SORT_OPTIONS,
  { value: 'none', label: 'None (products only)' },
];

interface FlatProduct {
  product: Product;
  /** Category names from the root down to the product's category. */
  path: string[];
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
  const sessions = useLiveQuery(() => db.session_records.toArray());
  const openSession = useLiveQuery(() => db.session.get('session'));
  const festivals = useLiveQuery(async () =>
    (await db.festivals.toArray()).sort((a, b) => a.name.localeCompare(b.name))
  );

  const [filter, setFilter] = useState<SalesFilter>({
    festival_id: null,
    range: null,
  });
  const [pickingRange, setPickingRange] = useState(false);
  const [showingWeekends, setShowingWeekends] = useState(false);
  const [categorySort, setCategorySort] =
    useState<CategorySortOrder>('catalog');
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

  // The weekends the per-weekend average divides by, with their sales and
  // sessions so she can see why each one counts.
  const workedWeekends = useMemo(() => {
    if (!transactions || !sessions || !lineItems) return [];
    const itemsByTx = new Map<ID, number>();
    for (const l of lineItems) {
      itemsByTx.set(
        l.transaction_id,
        (itemsByTx.get(l.transaction_id) ?? 0) + l.quantity
      );
    }
    return listWeekends(filter, transactions, sessions, itemsByTx);
  }, [transactions, sessions, lineItems, filter]);
  const weekends = workedWeekends.length;

  // Days with a sale at the chosen festival (or any festival), marked in the
  // calendar so that festival's weekends stand out.
  const saleDays = useMemo(
    () =>
      new Set(
        (transactions ?? [])
          .filter(
            (t) =>
              filter.festival_id === null ||
              t.festival_id === filter.festival_id
          )
          .map((t) => dayKey(t.occurred_at))
      ),
    [transactions, filter.festival_id]
  );

  // Build the category tree in catalog order, total every category, then
  // apply the two sort orders. Sorting is stable, so ties keep catalog
  // order. We include ALL products (even archived ones with past sales) so
  // historical numbers stay accurate. Empty categories still render so the
  // structure stays predictable. `flat` is every product in catalog order
  // (tree order), then sorted by the product sort — used when the category
  // sort is 'none'.
  const { tree, categoryTotals, flat } = useMemo(() => {
    if (!categories || !products) {
      return { tree: null, categoryTotals: null, flat: null };
    }
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

    const flatList: FlatProduct[] = [];
    function flatten(node: CategoryNode, path: string[]) {
      const here = [...path, node.name];
      for (const p of node.products) flatList.push({ product: p, path: here });
      for (const c of node.children) flatten(c, here);
    }
    roots.forEach((n) => flatten(n, []));
    sortBySold(flatList, productSort, (f) => productTotal(f.product));

    if (categorySort !== 'none') {
      const order = categorySort;
      function sortRec(list: CategoryNode[]) {
        sortBySold(list, order, (n) => totals.get(n.id) ?? 0);
        for (const n of list) {
          sortBySold(n.products, productSort, productTotal);
          sortRec(n.children);
        }
      }
      sortRec(roots);
    }
    return { tree: roots, categoryTotals: totals, flat: flatList };
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
    if (!tree || !flat) return;
    // CSV rows: full category path + product + size (when applicable) +
    // quantity (+ per-weekend average). Sized products emit one row per size
    // that had sales; everything else emits one row per product. Rows follow
    // the on-screen sort order (flat when the category sort is 'none').
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
    function emit(p: Product, path: string[]) {
      const entry = soldByProduct.get(p.id);
      if (!entry || entry.total === 0) return;
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
          push(path, p.name, size, qty);
        }
        // Any unsized quantity on a sized product (component decrements
        // or legacy line items) still needs to be represented.
        const sizedQty = Array.from(entry.bySize.values()).reduce(
          (a, b) => a + b,
          0
        );
        const remainder = entry.total - sizedQty;
        if (remainder !== 0) push(path, p.name, '', remainder);
      } else {
        push(path, p.name, '', entry.total);
      }
    }
    function walk(node: CategoryNode, path: string[]) {
      const here = [...path, node.name];
      for (const p of node.products) emit(p, here);
      for (const c of node.children) walk(c, here);
    }
    if (categorySort === 'none') {
      for (const f of flat) emit(f.product, f.path);
    } else {
      for (const n of tree) walk(n, []);
    }
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
        <label className="flex items-center gap-2 text-sm font-ui text-walnut/70">
          Festival
          <select
            className="input !min-h-0 !py-1.5 max-w-xs"
            value={filter.festival_id ?? ''}
            onChange={(e) =>
              setFilter((f) => ({ ...f, festival_id: e.target.value || null }))
            }
          >
            <option value="">All festivals</option>
            {festivals?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2 text-sm font-ui text-walnut/70">
          Dates
          <button
            type="button"
            className="btn-secondary !min-h-0 !py-1.5 text-sm"
            onClick={() => setPickingRange(true)}
            title="Pick a date range"
          >
            {filter.range
              ? rangeLabel(filter.range.start, filter.range.end)
              : 'All dates'}{' '}
            ✎
          </button>
          {filter.range && (
            <button
              type="button"
              className="text-walnut/60 hover:text-walnut px-1"
              onClick={() => setFilter((f) => ({ ...f, range: null }))}
              title="Clear dates (show all dates)"
              aria-label="Clear dates"
            >
              ✕
            </button>
          )}
        </div>
        <span className="text-sm text-walnut/70 ml-auto">
          Total sold:{' '}
          <strong className="font-display text-base text-walnut">
            {grandTotal}
          </strong>
          {weekends > 0 && (
            <>
              {' '}
              over{' '}
              <button
                type="button"
                className="underline decoration-dotted underline-offset-2 hover:text-walnut"
                onClick={() => setShowingWeekends(true)}
                title="See which weekends and sessions are counted"
              >
                {weekends} weekend{weekends === 1 ? '' : 's'}
              </button>
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
            onChange={(e) =>
              setCategorySort(e.target.value as CategorySortOrder)
            }
          >
            {CATEGORY_SORT_OPTIONS.map((o) => (
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
          {categorySort === 'none'
            ? flat?.map((f) => (
                <ProductLine
                  key={f.product.id}
                  product={f.product}
                  path={f.path}
                  entry={soldByProduct.get(f.product.id)}
                  weekends={weekends}
                  indent={12}
                />
              ))
            : tree.map((node) => (
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

      {showingWeekends && (
        <WeekendsDialog
          weekends={workedWeekends}
          festivalsById={new Map((festivals ?? []).map((f) => [f.id, f]))}
          showFestival={filter.festival_id === null}
          transactions={transactions ?? []}
          openSessionStartedAt={openSession?.started_at ?? null}
          onClose={() => setShowingWeekends(false)}
        />
      )}

      {pickingRange && (
        <DateRangePicker
          initial={filter.range}
          markedDays={saleDays}
          onApply={(start, end) => {
            setFilter((f) => ({ ...f, range: { start, end } }));
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
  path,
  entry,
  weekends,
  indent,
}: {
  product: Product;
  /** Category path, shown under the name in the flat (no-category) list. */
  path?: string[];
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
        <div className="min-w-0">
          <span className="flex items-center gap-1 truncate">
            <span className="text-walnut/30 text-xs w-3 inline-block">◦</span>
            <span className={product.archived ? 'text-walnut/50 italic' : ''}>
              {product.name}
              {product.archived && ' (archived)'}
            </span>
          </span>
          {path && (
            <div className="text-[11px] text-walnut/50 truncate pl-4">
              {path.join(' / ')}
            </div>
          )}
        </div>
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
  const parts: string[] = [];
  if (filter.festival_id !== null) {
    const name =
      festivals?.find((f) => f.id === filter.festival_id)?.name ?? 'festival';
    parts.push(
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    );
  }
  const { range } = filter;
  if (range) {
    parts.push(
      range.start === range.end ? range.start : `${range.start}-to-${range.end}`
    );
  }
  return parts.length > 0 ? parts.join('-') : 'all-sessions';
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
