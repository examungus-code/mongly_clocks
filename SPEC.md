# Clockwork Traveler — Inventory & Sales App

## Overview

A small offline-first inventory and point-of-sale app for a jewelry maker who sells
handmade watch-part pieces at Renaissance festivals. She manages her catalogue from
a desktop browser at home, takes a phone or tablet to the festival (no internet),
records sales offline all day, and syncs through Google Drive when she's back in town.

Only one device is active at a time (home desktop OR booth device, never both). This
keeps sync simple: no merge logic, no conflict resolution.

## Non-goals (v1)

- Multi-user / multi-seller support
- Returns and refunds
- Sales tax calculations
- Off-catalogue / one-off sales
- Card processing (she handles payment separately via Square etc., the app only
  records *that* a sale happened and how it was paid)
- Automatic sync (always explicit Push or Pull)

## Tech stack

- **Frontend:** React + Vite, TypeScript
- **PWA:** installable, full offline support via service worker
- **Local storage:** IndexedDB via Dexie
  - Structured data (categories, products, transactions, adjustments) in tables
  - Photos as Blobs in a separate `photos` table, keyed by photo id
- **Sync backend:** Google Drive API with `drive.file` OAuth scope
  - App can only see files it created — friendliest consent screen, no access to
    her other Drive content
- **Export:** in-browser CSV generation (she opens in Excel)
- **Styling:** Tailwind + custom theme to match the Clockwork Traveler aesthetic
  (see Visual Design below)
- **Drag & drop:** dnd-kit (works well on touch + mouse, accessible)

## Data model

### Category
Categories form an arbitrary-depth tree. Products live as children of categories.

```
Category {
  id: uuid
  name: string
  parent_id: uuid | null       // null = root
  sort_order: int              // for manual ordering within siblings
  created_at, updated_at
}
```

### Product
A design she makes in batches. Has a quantity on hand and a list price.

```
Product {
  id: uuid
  category_id: uuid            // must be a leaf-or-not category; products can
                               //   live at any node in the tree
  name: string
  description: string          // optional
  list_price: decimal          // in dollars, 2dp
  quantity_on_hand: int        // derived from adjustments + sales; cached here
                               //   for fast reads
  photo_id: uuid | null        // ref into photos table
  sort_order: int
  archived: bool               // soft delete (so old sales still reference a real
                               //   product); hidden from sales grid when true
  created_at, updated_at
}
```

### InventoryAdjustment
Every quantity change is logged. Sales generate `sold` adjustments implicitly when
a transaction is completed. Manual ones come from the Lost / Broken / Restocked
flows.

```
InventoryAdjustment {
  id: uuid
  product_id: uuid
  delta: int                   // negative for sold/lost/broken, positive for restock
  reason: 'sold' | 'lost' | 'broken' | 'restocked' | 'manual_correction'
  transaction_id: uuid | null  // set when reason='sold'
  note: string                 // optional, e.g. "dropped at booth 5/12"
  occurred_at: timestamp
  created_at
}
```

`Product.quantity_on_hand` = sum of all adjustments. Cached for read speed,
recomputed on any write. Source of truth is the adjustments log — never edit the
cached number directly.

### Transaction
A customer interaction. Wraps one or more line items so a customer who buys 3
pieces is one transaction, not three.

```
Transaction {
  id: uuid
  festival_id: uuid | null     // pulled from the active session
  payment_type_id: uuid        // pulled from the active session default, overridable
  total: decimal               // sum of line items; cached
  note: string                 // optional
  occurred_at: timestamp
  created_at
}

TransactionLineItem {
  id: uuid
  transaction_id: uuid
  product_id: uuid
  quantity: int
  unit_price: decimal          // defaults to product.list_price at time of sale,
                               //   overridable for haggling/bundles
  line_total: decimal          // quantity * unit_price, cached
}
```

### Festival
Configurable list — she manages from settings.

```
Festival {
  id: uuid
  name: string
  archived: bool
  created_at, updated_at
}
```

### PaymentType
Configurable list. Seed values: Cash, Card, Venmo, Other.

```
PaymentType {
  id: uuid
  name: string
  archived: bool
  sort_order: int
  created_at, updated_at
}
```

### Session
Ephemeral — represents the current selling context. Local-only, not synced.

```
Session {
  festival_id: uuid | null
  default_payment_type_id: uuid
  started_at: timestamp
}
```

### Photo
Just the file she uploaded. No processing, no transcoding, no resizing — whatever
she drops in is what gets stored and what gets synced to Drive. The browser's
`File` object already carries mime type and original filename, so we store the
file as-is and read those off it when we need them.

```
Photo {
  id: uuid
  file: File                   // a Blob; .type and .name come for free
}
```

Tradeoff: if she uploads 8MB phone originals, sync will be slow and storage will
grow fast. That's her call to make — we don't second-guess it with auto-
compression. If it becomes a real problem in practice, we can add a one-time
"shrink all photos" utility later, but it stays out of the upload path.

### SyncMetadata
Tracks last push/pull for the "Drive last updated yesterday on Phone" indicator.

```
SyncMetadata {
  last_push_at: timestamp | null
  last_pull_at: timestamp | null
  last_cloud_modified_at: timestamp | null
  last_cloud_device_label: string | null
  device_label: string         // user-set, e.g. "Phone", "Desktop", "Tablet"
}
```

## Screens

### 1. Home / Dashboard
- Today's session summary (if active): festival, revenue today, items sold today
- Big "Start Session" button if no active session
- Tiles: Sell, Inventory, Catalogue, History, Sync, Settings

### 2. Start Session
- Pick festival from dropdown (or "+ New festival" inline)
- Pick default payment type
- "Start" → sets session, routes to Sell screen

### 3. Sell (booth screen, optimized for touch)
- Top bar: current festival, today's totals ($X, N items), end-session button
- Search bar (text search across product names, all categories)
- Below: either tree breadcrumb navigation OR search results, as a grid of photo
  tiles with product name and price beneath
- Tap a tile → bottom sheet:
  - Big primary button: **Add to Cart**
  - Secondary: Sold (immediate single-line transaction), Lost, Broken
  - Quantity selector (defaults 1)
  - Price override field (collapsed; tap to expand)
- Floating cart button bottom-right with line count + running total
- Cart screen:
  - Line items with photo, name, qty stepper, unit price (editable), line total
  - Swipe-to-remove
  - Payment type selector (defaults to session default)
  - Note field (collapsed)
  - **Complete Transaction** primary button
  - "Discard cart" secondary

### 4. Catalogue (desktop-primary)
- Left pane: category tree
  - Drag to reparent or reorder
  - Right-click / long-press for: Add child category, Rename, Delete (with prompt
    asking what to do with contained products)
- Right pane: products in selected category
  - Grid of cards (photo, name, price, qty on hand)
  - Drag to reorder within category, drag onto a category in the tree to move
  - Click product → edit pane: photo upload (drag-drop zone), name, description,
    price, restock button (+N qty, logs adjustment), archive button

### 5. Inventory adjustments log
- Filterable list: by product, by reason, by date range
- Each row: timestamp, product, delta, reason, note
- Read-only (adjustments are append-only); to fix a mistake, add a corrective
  adjustment

### 6. History (transactions)
- Filterable: by date, by festival, by payment type
- Each row: timestamp, festival, total, payment type, line count
- Tap to expand: line items
- Export button → CSV download (per current filter)

### 7. Sync
- Big indicator: "Drive last updated 2026-05-22 on Phone"
- Two big buttons: **Push to Drive** (with confirmation: "this will overwrite the
  cloud copy") and **Pull from Drive** (with confirmation: "this will overwrite
  your local data")
- Sign in with Google flow (first time only)
- Progress indicator during sync, with photo count

### 8. Settings
- Device label (used in sync metadata)
- Manage festivals (CRUD)
- Manage payment types (CRUD)
- Default session settings
- About / version

## Sync protocol

Single Drive folder created by the app, named `Clockwork Traveler`, placed in
the root of her My Drive on first sync. The app uses the `drive.file` scope so
it can only see files it created, even though the folder itself is browsable in
her Drive UI. If she ever moves or renames the folder, the app finds it by its
stored file ID (cached in local SyncMetadata); if she deletes it, the app
recreates it on next sync and a fresh push uploads everything. Contents:

```
clockwork-traveler/
  data.json              # all structured data
  photos/
    <uuid>.<ext>         # one file per product photo, original extension preserved
  meta.json              # last modified, device label, schema version
```

### Push
1. Serialize all tables (categories, products, transactions, line items,
   adjustments, festivals, payment types) into a single JSON blob.
2. Upload `data.json`, replacing the existing one.
3. For each local photo not yet on Drive, upload as `photos/<uuid>.<ext>` —
   extension taken from the stored `File.name` (or derived from `File.type` if
   the original name had none). The file bytes are uploaded as-is.
4. For each photo on Drive but not referenced locally, delete it.
5. Update `meta.json` with timestamp + device label.
6. Update local `SyncMetadata.last_push_at`.

### Pull
1. Download `meta.json` to confirm there's a remote copy.
2. Download `data.json`, parse, validate schema version.
3. List `photos/` directory; download any photos referenced by products that
   aren't already in local IndexedDB.
4. Delete local photos not referenced in the pulled data.
5. Replace all local tables with pulled data in a single transaction (so a failed
   pull leaves the database untouched).
6. Update local `SyncMetadata.last_pull_at` + cloud metadata fields.

### Schema versioning
`meta.json` includes a schema version. On pull, if the cloud version is older,
run forward migrations before loading. If newer, refuse and tell her to update
the app.

## Visual design — Clockwork Traveler aesthetic

Steampunk / vintage-clockwork themed:

- **Palette:** aged brass (#B5895A), dark walnut (#3B2A1E), ivory parchment
  (#F2E8D5), oxidized copper accents (#7A4A2E), deep gear-shadow black (#1A130C)
- **Typography:**
  - Headings: a serif with slight Victorian flair (Cormorant Garamond or
    similar)
  - Body: a clean readable serif or humanist sans (Lora / Inter) — readability
    wins over flair in dense screens like Catalogue and History
- **Iconography:** gear/cog motifs, key-shaped buttons for primary actions, hands
  of a clock for time-related UI. Subtle, not cartoonish.
- **Textures:** parchment background texture on dashboard and session screens;
  cleaner solid surfaces on dense data screens to keep legibility.
- **Touch targets:** booth screens are large-finger-friendly — 48px minimum tap
  size, generous spacing.

A theme file (`theme.ts`) centralizes colors, fonts, spacing so it's
straightforward to swap or tone down the aesthetic if it gets in the way.

## File / folder layout (proposed)

```
clockwork_traveler/
  SPEC.md                      # this doc
  README.md                    # quick-start, dev commands
  package.json
  vite.config.ts
  tsconfig.json
  index.html
  src/
    main.tsx
    app.tsx
    theme.ts
    db/                        # Dexie schema + migrations
      schema.ts
      migrations.ts
      queries.ts               # high-level read/write helpers
    sync/                      # Google Drive sync
      drive-client.ts          # auth + raw Drive API calls
      push.ts
      pull.ts
      serialize.ts             # data <-> json
    domain/                    # business logic, pure functions
      transactions.ts          # cart ops, completing a transaction
      inventory.ts             # adjustments, qty recomputation
      catalogue.ts             # category tree ops
    screens/
      dashboard/
      session/
      sell/
      cart/
      catalogue/
      inventory-log/
      history/
      sync/
      settings/
    components/                # shared UI: buttons, tiles, dialogs, tree
    hooks/
    utils/
      csv-export.ts
  public/
    icons/                     # PWA icons
    manifest.webmanifest
    service-worker.ts          # offline shell
```

## Open questions / things to decide later

- **Multi-photo per product** — v1 is one photo per product. If she wants
  multiple angles later, the `photo_id` field becomes a `photo_ids[]`.
- **Backup / version history on Drive** — right now Push overwrites. Could keep
  the last N data.json files for rollback. Low priority but easy to add.
- **Bulk import** — if she has an existing spreadsheet of products, would a
  CSV import save hours? Probably yes if her catalogue is already digital
  anywhere.
- **Quick-add category from within product edit** — small UX nice-to-have.
- **Print-friendly inventory sheet** — for a paper backup at the booth in case
  the device dies. Worth considering after v1 is in her hands.

## Build phases

A rough order so we can ship something usable quickly:

1. **Phase 1 — Local-only catalogue.** DB schema, category tree CRUD with drag-
   and-drop, product CRUD with photo upload, restock/lost/broken adjustments.
   She can manage her whole catalogue at home.
2. **Phase 2 — Local-only sales.** Session, sell screen, cart, complete
   transaction, history view, CSV export. She can use it offline at a faire,
   even without sync, by just running it on one device.
3. **Phase 3 — Sync.** Drive auth, push, pull, sync UI with confirmations.
4. **Phase 4 — Polish.** PWA installability, full steampunk theming pass,
   onboarding, error states, empty states.
```
