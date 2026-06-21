# revpdf — Build Phases

Tracks progress against the milestones in [`SPEC.md`](./SPEC.md) §13.
Legend: ✅ done · 🟡 partial · ⬜ not started.

_Last updated: 2026-06-21_

---

## M1 — Skeleton ✅
- ✅ Expo SDK 54 + TypeScript + expo-router 6 scaffolded at repo root (downgraded from 56).
- ✅ Project libraries installed (Paper, Zustand, sqlite, webview, bottom-sheet, brightness, slider, vector-icons).
- ✅ App identity: name/slug/scheme `revpdf`.
- ✅ MD3 theme system — Light / Dark / Sepia (`src/theme/`). Dark text is soft gray `#C9C9C9`, not white.
- ✅ Root providers: Paper + gesture handler + safe area + bottom-sheet modal + status bar (`src/app/_layout.tsx`).
- ✅ Settings store with AsyncStorage persistence (`src/store/settings.ts`).
- ✅ Navigation map: library, document/[id], reader/[id], settings, settings/reader, settings/search.
- ✅ Typecheck clean; Android Metro bundle succeeds (2055 modules).

## M2 — Library & Import ✅ (custom thumbnails deferred)
- ✅ Import via system file picker; local copy into app sandbox (`src/store/library.ts`).
  - 🐞 Fixed: some sources (content:// EPUBs) copied as **0-byte files** via the new `File().copy()`. Now uses legacy `copyAsync` + size validation, and the reader reports empty files instead of rendering blank.
- ✅ SQLite schema + queries: documents, highlights, bookmarks (`src/db/`).
- ✅ "Reading Now" library shelf with cover, format/size, progress, quick actions, search filter, FAB import, empty state.
- ✅ "About Document" detail: cover, metadata, action row (favorite/rename/share/delete), Read/Continue.
- 🟡 Thumbnails: format-tinted fallback only. Cover extraction (PDF first page / EPUB cover) → M3/M6.

## M3 — Reader core 🟡 (EPUB + PDF engines landed; DOCX next)
- ✅ Offline self-contained reader: vendored **epub.js + jszip** inlined into `assets/reader/reader.html` via `scripts/build-reader.mjs` (`npm run build:reader`). Loaded as a Metro `.html` asset (`metro.config.js`).
- ✅ RN ↔ WebView **bridge protocol** (`src/reader/bridge.ts`): loadBook, applyTheme, applyTypography, next/prev, goto, highlights, search, clearSelection; inbound ready/loaded/location/tap(zone)/selection/searchResults/error.
- ✅ WebView controller (`src/reader-web/controller.js`): epub.js init, theme + typography application, tap-zone paging, selection + relocation events, annotations, spine search.
- ✅ `ReaderWebView` component (`src/components/ReaderWebView.tsx`): reads the local file as base64, pushes live theme/typography from settings, exposes imperative handle.
- ✅ Reader screen wired: chrome-free surface, tap-zone paging (left/right) + center toggles bar, **progress persistence** (debounced → SQLite), TOC captured, brightness applied on entry/restored on exit.
- ✅ **EPUB** rendering path complete end-to-end (engine code; on-device verification needs a dev client).
- ✅ **PDF** path — vendored **PDF.js v3** (UMD) + worker inlined as a Blob; lazy per-page canvas rendering via IntersectionObserver, text layer for selection/search, dark-mode canvas invert, scroll paging, page-based progress (`page:N`) persisted and restored.
- 🟡 PDF highlights: selection → search works; persistent visual highlights on PDF deferred (no CFI anchor — needs page+rect model, M5/M6).
- ⬜ DOCX → HTML conversion (mammoth) feeding the reflowable renderer.

> ✅ Verified on an Android emulator (dev client): EPUB renders (epub.js), dark theme + justified
> text apply, page-turn + progress persistence work, PDF renders, and selection → Google search
> sheet works end-to-end. PDF font-size now maps to zoom (re-render at scale).
>
> Post-test fixes (all verified on device): import 0-byte copy bug; **edge-tap pagination** (RN
> edge zones); **font family** (5 fonts bundled as @font-face, injected into EPUB iframes);
> compact selection sheet; light/sepia/dark + DuckDuckGo + disabled-search all confirmed.

## M4 — Typography & display 🟡 (UI done, wiring pending)
- ✅ Reader settings panel with live preview: theme, font family, size, thickness, alignment, hyphenation, page margins, line spacing, brightness (`src/app/settings/reader.tsx`).
- ✅ Bundled font set defined (Alice, Comfortaa, Merriweather, Roboto, Noto Serif).
- ✅ Inject theme + typography (font, size, weight, align, line-height, margins, hyphenation, flow) into the EPUB reader live from settings.
- ✅ Apply per-reader brightness via expo-brightness; restore on exit.
- ⬜ Load @font-face web fonts for the bundled families into the reader (currently relies on system/embedded fonts).
- ⬜ Reflow-vs-fixed gating in-context (hide N/A controls for PDF).

## M5 — Signature interactions 🟡
- ✅ Selection bottom sheet (peek → drag-up expand) with in-app search WebView — **auto-loads results** on selection (`src/components/SelectionSheet.tsx`). Verified on device: select → Google results, drag up for full page.
- ✅ Search engine query routing (Google/DDG/Yandex/Yahoo/Disabled).
- 🟡 Hold-to-highlight: highlight action present in the sheet (EPUB, persisted). Dedicated long-press color picker still to do.
- 🟡 Trigger rule: on-selection works; "tap a word" mode still maps to selection.

## M6 — TOC, search, thumbnails, polish ⬜
- ⬜ In-document search (epub.js / PDF.js findController) with match nav.
- ⬜ Table of contents from EPUB nav / PDF outline.
- ⬜ Custom page thumbnails (pick a page or image).
- ⬜ Annotations/highlights list screen.
- ⬜ Empty/error/loading states across screens.

## M7 — Hardening ⬜
- ⬜ DOC/DOCX conversion robustness (legacy `.doc` likely out for v1).
- ⬜ Large-file performance.
- ⬜ Accessibility pass (focus, reduced motion, touch targets).
- ⬜ Custom dev client build (`expo run:android`) to exercise native modules end-to-end.

---

### Settings coverage (spec §8) — status
| Setting | State |
|---|---|
| Theme (light/dark/sepia) | ✅ |
| Highlighting on/off | ✅ stored, ⬜ effect (M5) |
| Bottom sheet on/off + trigger | ✅ stored, ⬜ effect (M5) |
| Search engine (incl. disabled) | ✅ stored + templates, ⬜ effect (M5) |
| Reading mode | ✅ stored, ⬜ effect (M3) |
| Reader display controls | ✅ UI, ⬜ effect (M3/M4) |
| About (revpdf, revpdf.in, /terms, /privacy) | ✅ |

### Known follow-ups / open questions (spec §14)
- Legacy `.doc` support decision (recommend `.docx` only for v1).
- Custom dev client required before the WebView reader can be exercised on device.
