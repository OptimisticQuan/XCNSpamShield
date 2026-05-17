# XCNSpamShield Extension

Manifest V3 extension built with TypeScript and Vite.

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm typecheck
pnpm test --run
```

## What is implemented

- Popup controls for blocking mode, extraction, local review, delete, relabel, and export.
- Content-script extraction of the current main post and visible first-level replies.
- Heuristic spam detection and an optional TF.js model-loading boundary.
- IndexedDB persistence through the background service worker.

## Integration notes

- Build output lands in `dist/` and can be loaded as an unpacked extension.
- TF.js artifacts are expected under `public/tfjs_model/`.
- X selectors are isolated under `src/content/selectors.ts` for easier maintenance.
