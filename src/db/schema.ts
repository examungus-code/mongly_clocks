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
  created_at: number;
  updated_at: number;
}

export type AdjustmentReason =
  | 'sold'
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
export interface Session {
  id: 'session';
  festival_id: ID | null;
  default_payment_type_id: ID | null;
  started_at: number | null;
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
  }
}

export const db = new ClockworkDB();

// SCHEMA_VERSION is written to meta.json on Drive sync. Bump when a future
// migration is needed; pull will refuse a cloud copy with a higher version.
// v2: Product.subtypes / Product.default_subtype, TransactionLineItem.subtype.
//     Older devices missing these fields handle them as empty / null.
export const SCHEMA_VERSION = 2;
