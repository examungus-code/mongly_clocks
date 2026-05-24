// Bundle local DB tables (except photos) into a JSON object for Drive sync,
// and the inverse: restore tables from such an object.
//
// Photos are NOT included in the JSON; they're uploaded as separate files
// keyed by the photo id. The JSON's `photos` field is a manifest mapping
// photo id → extension (so pull can reconstruct filenames).

import { db, SCHEMA_VERSION } from '../db/schema';
import type {
  Category,
  Festival,
  InventoryAdjustment,
  PaymentType,
  Product,
  Transaction,
  TransactionLineItem,
} from '../db/schema';

export interface SnapshotPayload {
  schema_version: number;
  exported_at: number;
  categories: Category[];
  products: Product[];
  adjustments: InventoryAdjustment[];
  transactions: Transaction[];
  line_items: TransactionLineItem[];
  festivals: Festival[];
  payment_types: PaymentType[];
  photos: Array<{ id: string; ext: string }>;
}

export async function snapshotLocal(): Promise<SnapshotPayload> {
  const [
    categories,
    products,
    adjustments,
    transactions,
    line_items,
    festivals,
    payment_types,
    photos,
  ] = await Promise.all([
    db.categories.toArray(),
    db.products.toArray(),
    db.adjustments.toArray(),
    db.transactions.toArray(),
    db.line_items.toArray(),
    db.festivals.toArray(),
    db.payment_types.toArray(),
    db.photos.toArray(),
  ]);

  return {
    schema_version: SCHEMA_VERSION,
    exported_at: Date.now(),
    categories,
    products,
    adjustments,
    transactions,
    line_items,
    festivals,
    payment_types,
    photos: photos.map((p) => ({
      id: p.id,
      ext: deriveExt(p.file),
    })),
  };
}

export async function restoreLocal(
  snapshot: SnapshotPayload,
  freshPhotos: Map<string, File>
): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.categories,
      db.products,
      db.adjustments,
      db.transactions,
      db.line_items,
      db.festivals,
      db.payment_types,
      db.photos,
    ],
    async () => {
      await Promise.all([
        db.categories.clear(),
        db.products.clear(),
        db.adjustments.clear(),
        db.transactions.clear(),
        db.line_items.clear(),
        db.festivals.clear(),
        db.payment_types.clear(),
        db.photos.clear(),
      ]);
      await db.categories.bulkAdd(snapshot.categories);
      await db.products.bulkAdd(snapshot.products);
      await db.adjustments.bulkAdd(snapshot.adjustments);
      await db.transactions.bulkAdd(snapshot.transactions);
      await db.line_items.bulkAdd(snapshot.line_items);
      await db.festivals.bulkAdd(snapshot.festivals);
      await db.payment_types.bulkAdd(snapshot.payment_types);
      for (const [id, file] of freshPhotos) {
        await db.photos.put({ id, file });
      }
    }
  );
}

export function deriveExt(file: File): string {
  // Try filename first, then MIME type. Default to .bin.
  const fromName = file.name?.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0];
  if (fromName) return fromName.toLowerCase();
  const mime = file.type;
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'image/heic') return '.heic';
  return '.bin';
}
