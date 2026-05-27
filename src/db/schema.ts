// IndexedDB schema for Clockwork Traveler.
//
// All quantity changes are captured as InventoryAdjustment rows. Product.quantity_on_hand
// is a denormalized cache of "sum of all adjustments for this product" — it's recomputed
// on every write that affects it. The adjustments log is the source of truth; never
// write quantity_on_hand without a matching adjustment row.
//
// Photos are stored as raw File objects (a Blob with .name and .type) in a separate
// table so loading products doesn't pay the photo bytes. No image processing happens
// anywhere — what the user uploads is what gets stored and synced.

import Dexie, { type Table } from 'dexie';

export type ID = string;

export interface Category {
  id: ID;
  name: string;
  parent_id: ID | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface Product {
  id: ID;
  category_id: ID;
  name: string;
  description: string;
  list_price: number; // dollars, 2dp; store as number, format on render
  quantity_on_hand: number; // cache: sum of adjustments
  photo_id: ID | null;
  sort_order: number;
  archived: boolean;
  // Subtypes are optional sale-time variants of a product (e.g. metal: silver
  // / gold / copper). They are *labels* in this model — they don't split the
  // qty pool. If subtypes is empty, no selector is shown at sale time. If
  // default_subtype is set, it pre-fills the selector; if null, the operator
  // must pick one before the sale records.
  subtypes: string[];
  default_subtype: string | null;
  // Optional component-product link per subtype. When the necklace is sold
  // with subtype 'gold', the linked product (e.g. "gold chain") is also
  // decremented from inventory via a 'sold_component' adjustment. Keys are
  // subtype names; missing key = no link. When she renames a subtype the
  // key follows; when she removes a subtype the key is dropped on save.
  subtype_links: Record<string, ID>;
  created_at: number;
  updated_at: number;
}

export type AdjustmentReason =
  | 'sold'
  | 'sold_component' // Decrement of a component linked to a sold product's subtype.
                     // Hidden from the inventory log; still counts toward qty.
  | 'lost'
  | 'broken'
  | 'restocked'
  | 'manual_correction';

export interface InventoryAdjustment {
  id: ID;
  product_id: ID;
  delta: number; // negative for sold/lost/broken, positive for restocked
  reason: AdjustmentReason;
  transaction_id: ID | null;
  // Set when this adjustment was caused by a specific line item ('sold' rows
  // reference the line they're decrementing; 'sold_component' rows reference
  // the line whose subtype link triggered them). Optional for backward compat
  // with pre-v3.1 data; lookups gracefully fall back to (transaction_id +
  // product_id) matching when this is missing.
  line_item_id?: ID;
  note: string;
  occurred_at: number;
  created_at: number;
}

export interface Transaction {
  id: ID;
  festival_id: ID | null;
  payment_type_id: ID;
  total: number; // cached sum of line items
  note: string;
  occurred_at: number;
  created_at: number;
}

export interface TransactionLineItem {
  id: ID;
  transaction_id: ID;
  product_id: ID;
  quantity: number;
  unit_price: number; // overrideable per-line
  line_total: number; // cached: quantity * unit_price
  // Snapshot of the subtype selected at sale time. Stored as a string (not an
  // ID) so renaming a subtype later doesn't rewrite history.
  subtype: string | null;
}

export interface Festival {
  id: ID;
  name: string;
  archived: boolean;
  created_at: number;
  updated_at: number;
}

export interface PaymentType {
  id: ID;
  name: string;
  archived: boolean;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface Photo {
  id: ID;
  // File extends Blob and carries .name + .type, so we don't need to mirror those.
  file: File;
}

// Local-only, not synced. Lives in a single-row table keyed by 'session'.
// Mirrors the currently-active SessionRecord for fast lookup and to keep
// existing consumers working unchanged.
export interface Session {
  id: 'session';
  festival_id: ID | null;
  default_payment_type_id: ID | null;
  started_at: number | null;
}

// Synced history of every session (start + festival + end). Each entry is
// effectively one selling event (a faire day, a market, etc.). Transactions
// are bound to a session by their occurred_at falling between
// started_at and ended_at — we don't store session_id on the transaction
// to avoid a schema change on Transaction.
export interface SessionRecord {
  id: ID;
  festival_id: ID | null;
  default_payment_type_id: ID | null;
  started_at: number;
  ended_at: number | null; // null = still active
  created_at: number;
  updated_at: number;
}

// Local-only sync metadata, single-row keyed by 'sync'.
export interface SyncMetadata {
  id: 'sync';
  last_push_at: number | null;
  last_pull_at: number | null;
  last_cloud_modified_at: number | null;
  last_cloud_device_label: string | null;
  device_label: string;
  drive_folder_id: string | null;
}

// Local-only app preferences, single-row keyed by 'prefs'.
export interface AppPrefs {
  id: 'prefs';
  schema_seeded: boolean;
}

class ClockworkDB extends Dexie {
  categories!: Table<Category, ID>;
  products!: Table<Product, ID>;
  adjustments!: Table<InventoryAdjustment, ID>;
  transactions!: Table<Transaction, ID>;
  line_items!: Table<TransactionLineItem, ID>;
  festivals!: Table<Festival, ID>;
  payment_types!: Table<PaymentType, ID>;
  photos!: Table<Photo, ID>;
  session!: Table<Session, 'session'>;
  session_records!: Table<SessionRecord, ID>;
  sync_meta!: Table<SyncMetadata, 'sync'>;
  prefs!: Table<AppPrefs, 'prefs'>;

  constructor() {
    super('clockwork_traveler');
    this.version(1).stores({
      categories: 'id, parent_id, sort_order',
      products: 'id, category_id, archived, sort_order',
      adjustments: 'id, product_id, occurred_at, transaction_id, reason',
      transactions: 'id, festival_id, occurred_at, payment_type_id',
      line_items: 'id, transaction_id, product_id',
      festivals: 'id, archived',
      payment_types: 'id, archived, sort_order',
      photos: 'id',
      session: 'id',
      sync_meta: 'id',
      prefs: 'id',
    });
    // v2 schema: adds session_records table. Existing devices upgrade
    // automatically and start tracking new sessions; old in-flight singleton
    // sessions are promoted into the new table at app start (see seed.ts).
    this.version(2).stores({
      session_records: 'id, started_at, ended_at, festival_id',
    });
  }
}

export const db = new ClockworkDB();

// SCHEMA_VERSION is written to meta.json on Drive sync. Bump when a future
// migration is needed; pull will refuse a cloud copy with a higher version.
// v2: Product.subtypes / Product.default_subtype, TransactionLineItem.subtype.
//     Older devices missing these fields handle them as empty / null.
// v3: Product.subtype_links, 'sold_component' AdjustmentReason. Older
//     devices ignore unknown fields and unknown reasons just render as text;
//     refusing the pull is still the safe move because they'd miss the
//     component side-effects on sales.
// v4: SessionRecord table (history of every session). Older clients would
//     lose this history on round-trip; refuse pull.
export const SCHEMA_VERSION = 4;
