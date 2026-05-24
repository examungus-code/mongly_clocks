# Clockwork Traveler

An offline-first inventory and point-of-sale Progressive Web App for a jewelry
maker who sells handmade watch-part pieces at Renaissance festivals.

- Manages a catalogue of designs organized in an arbitrary-depth category tree
- Records sales offline at the festival on a phone or tablet
- Syncs to Google Drive when back online for review on a desktop
- Exports transaction history to CSV for business analysis

See [SPEC.md](./SPEC.md) for the full design — data model, screens, sync
protocol, and build phases.

## Status

Pre-implementation. Spec is settled; scaffolding next.

## Stack

React + Vite + TypeScript, Dexie (IndexedDB), Google Drive API (`drive.file`
scope), dnd-kit, Tailwind. Deployed as a static PWA to GitHub Pages.
