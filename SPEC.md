# RevReader — Product & Technical Specification

> App name: **revpdf**. A minimalist, Material Design 3 document reader for PDF / EPUB / DOC /
> DOCX, modeled on **ReadEra**, built with **Expo + React Native**. Fully **local / offline** —
> no accounts, no servers, no cloud.
>
> Settings → About: name **revpdf**, website **revpdf.in**, Terms **revpdf.in/terms**,
> Privacy **revpdf.in/privacy** (opened in the in-app browser).

Status: Draft v0.1
Last updated: 2026-06-21

---

## 1. Vision

A clean, fast, **minimalistic** reading app for long-form documents. It looks and feels like
ReadEra's reading experience, uses **Google Material Design 3 (Material You)** components, and
adds two signature interactions ReadEra does not have:

1. **Hold-to-highlight** — long-press a sentence/word to highlight it and pick a color.
2. **Chrome-style selection search** — selecting text raises a draggable bottom sheet that shows
   a preview of the selection and "tap to see search results"; dragging it up expands into a
   full in-app search view (see `ref/material.jpeg` and `ref/inbuilt-search.jpeg`).

Unlike ReadEra, there is **no dictionary**. The search-engine lookup replaces it.

---

## 2. Goals & Non-Goals

### Goals
- Read **PDF, EPUB, DOC, DOCX** with a distraction-free reading surface (`ref/readera-inside.jpeg`).
- Library / "Reading Now" shelf with progress, like `ref/readera-look.jpeg`.
- "About Document" detail screen, like `ref/readera-specific.jpeg`.
- Theming: **Light / Dark / Sepia**.
- Reflowable typography: font size, font family, font thickness (weight), text alignment
  (justify / left / center / right), hyphenation.
- Per-document **brightness**, **table of contents**, **in-document search**, **page thumbnails**.
- **Highlighting** with color choice (toggleable in Settings).
- **Selection → search** with configurable engine (Google / DuckDuckGo / Yandex / Yahoo / off).
- Material Design 3 UI throughout; minimalist by default.

### Non-Goals (v1)
- No dictionary / translation.
- No cloud sync / accounts.
- No text-to-speech (ReadEra's "READ aloud" is out of scope for v1).
- No DRM-protected file support (Adobe ADEPT, Kindle, etc.).
- No annotations export to PDF/email (v1 keeps annotations in-app only).

---

## 3. Target Platforms

- **Android** — primary target (ReadEra's home turf; Material Design is native there).
- **iOS** — supported, same codebase.
- Phone-first portrait layouts; tablet/landscape are nice-to-have, not blocking for v1.

---

## 4. Tech Stack

> Principle: render **all** documents inside a WebView so text selection, highlighting, and
> theming share one engine. This is the cleanest way to get the highlight + Chrome-style
> selection features working identically across formats.

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Expo** (managed) + **custom dev client** | Native deps (WebView, brightness, SQLite) need a dev build; **Expo Go is not sufficient**. |
| Language | TypeScript | Strict mode. |
| UI components | **react-native-paper** | Material Design 3 (Material You) components. |
| Navigation | **expo-router** | File-based routing. |
| State | **Zustand** | Minimal; one store per domain (library, reader, settings). |
| Persistence (data) | **expo-sqlite** | Library, reading progress, highlights, bookmarks. |
| Persistence (settings) | **AsyncStorage** (`@react-native-async-storage/async-storage`) | Simple key/value for app settings. |
| Files | **expo-file-system** + **expo-document-picker** | Import & store documents in app sandbox. |
| EPUB / DOCX rendering | **epub.js** (`epubjs`) in WebView | Reflowable; native theming, font, selection, CFI-based highlights. |
| PDF rendering | **PDF.js** (`pdfjs-dist`) in WebView | Renders canvas + **text layer** → enables selection & highlight overlays. |
| DOC / DOCX → HTML | **mammoth.js** (DOCX), conversion step | DOCX → HTML, fed to the reflowable (epub.js-style) renderer. Legacy `.doc` is best-effort — see Open Questions. |
| WebView | **react-native-webview** | Hosts both renderers; bridges selection/highlight events to RN. |
| Bottom sheet | **@gorhom/bottom-sheet** | The Chrome-style draggable selection/search sheet. |
| Brightness | **expo-brightness** | Per-reader screen brightness override. |
| Orientation / immersive | **expo-screen-orientation**, **expo-navigation-bar**, **expo-status-bar** | Fullscreen, chrome-free reading. |
| Color picker | **reanimated-color-picker** (or a small custom swatch row) | Highlight color selection. |
| Gestures/animation | **react-native-gesture-handler**, **react-native-reanimated** | Required by bottom-sheet & smooth UI. |

### Rendering architecture (key decision)

```
┌─────────────────────────── React Native (Expo) ───────────────────────────┐
│  Library / About / Settings screens  (react-native-paper, expo-router)     │
│                                                                            │
│  Reader Screen                                                             │
│   ├─ <WebView/>  ──────────────► HTML/JS reader bundle                     │
│   │     • EPUB/DOCX → epub.js                                              │
│   │     • PDF       → PDF.js (canvas + text layer)                         │
│   │     • applies theme/font/size/weight/align/hyphenation via CSS         │
│   │     • emits events: onSelection, onLongPressHighlight, onLocationChange │
│   │                                                                        │
│   ├─ @gorhom/bottom-sheet  ◄──── selection text → preview + search expand  │
│   └─ Reanimated color picker ◄── long-press → highlight color              │
└────────────────────────────────────────────────────────────────────────────┘
```

The WebView ↔ RN bridge uses `postMessage` for: text selected, long-press highlight requested,
location/progress changed, TOC parsed, search results (match positions).

**Why WebView-based for PDF too:** native PDF libraries (`react-native-pdf`) have weak/no text
selection. PDF.js exposes a real text layer, so selection, highlight overlays, and in-document
search behave the same as EPUB. Fixed-layout typography controls (font, align) simply don't
apply to PDF — see §11.

---

## 5. Supported Formats & Behavior Class

| Format | Render path | Class | Reflow typography? |
|---|---|---|---|
| EPUB | epub.js | Reflowable | ✅ font, size, weight, align, hyphenation |
| DOCX | mammoth → HTML → epub.js-style | Reflowable | ✅ |
| DOC (legacy) | best-effort convert → HTML | Reflowable | ✅ if conversion succeeds |
| PDF | PDF.js | Fixed-layout | ❌ (zoom/brightness/highlight/search only) |

---

## 6. Screens & Navigation Map

```
/(library)            Library — "Reading Now" shelf            ← home
/document/[id]        About Document (cover, metadata, READ)
/reader/[id]          Reader (chrome-free reading surface)
/settings             Settings (global)
/settings/reader      Reader display controls (see §7.10)
/settings/search      Search engine selection
```

### 6.1 Library ("Reading Now") — ref/readera-look.jpeg
- Top app bar: menu, title "Reading Now", search icon, overflow.
- List rows: thumbnail, title, `FORMAT, size`, **progress bar**, quick-action row
  (favorite ☆, recent ⏱, mark-read ✔✔, collections, overflow ⋮).
- FAB or app-bar action to **import** documents (`expo-document-picker`).
- Sort/filter: recent, title, format. (Minimal — recent by default.)

### 6.2 About Document — ref/readera-specific.jpeg
- Large cover, title/metadata block, action row (favorite, recent, read-status, collections,
  share, delete, edit/rename).
- Prominent **READ** button → `/reader/[id]`.
- Shows progress % and last-opened timestamp.

### 6.3 Reader — ref/readera-inside.jpeg
- **Chrome-free by default.** No persistent toolbars while reading.
- Single **center-tap** reveals a minimal, auto-hiding top app bar (back + overflow ⋮) and a
  thin bottom progress indicator. Tapping again hides them.
- All *display adjustment* controls live in **Reader Settings** (§7.10), reached from the
  overflow menu and from global Settings. This honors the requirement that font/align/TOC/
  search/size/thickness/brightness/thumbnail are **hidden during reading** and accessed via
  settings.
- Edge taps / horizontal swipe = page turn (paginated) or vertical scroll (configurable).

---

## 7. Feature Specifications

### 7.1 Theming — Light / Dark / Sepia
- Three reading themes applied to **both** the RN chrome (via Paper `MD3` theme) and the WebView
  reader (via injected CSS variables).
- Sepia: warm off-white background (`#F4ECD8`-ish) with dark brown text.
- **Dark (night) mode text is NOT pure white.** Use a soft grayish off-white (≈ `#C9C9C9` /
  `#CDCDCD`, ~80% gray) on a near-black background (`#121212`) to reduce halation/eye strain —
  matching the subtle grayish tone of the reference. Pure `#FFFFFF` text is explicitly avoided.
- Theme switch is instant; persisted globally and overridable per-document later (v2).

### 7.2 Font Size
- Continuous or stepped scale (e.g. 80%–200%). Live preview. Reflowable only.

### 7.3 Font Family
- Bundled set (v1): **Alice**, **Comfortaa**, **Merriweather**, **Roboto**, **Noto Serif**, plus
  **Original** (publisher default). (All available as Google Fonts.) "Alice" assumed for the
  brief's "Alic" — confirm in Open Questions.
- Fonts loaded via `expo-font` and injected into the WebView (`@font-face`).

### 7.4 Font Thickness (weight)
- Maps to font-weight (e.g. Light 300 / Regular 400 / Medium 500 / Bold 700) where the chosen
  family provides the weights. Reflowable only.

### 7.5 Text Alignment & Hyphenation
- Alignment: **Justify / Left / Center / Right** via CSS `text-align`.
- **Hyphenation** toggle via CSS `hyphens: auto` + lang-aware dictionaries. Reflowable only.

### 7.5a Page Margins
- **On/off** toggle. On = comfortable reading margins (CSS padding around the text column);
  Off = edge-to-edge text. Reflowable only.

### 7.5b Line Spacing
- Slider **0–100%** mapping to CSS `line-height` (0% = tight/default baseline, 100% = max
  loosened). Live preview. Reflowable only.

### 7.6 Brightness
- Per-reader override via `expo-brightness`; restored to system on exit. Slider in Reader Settings.

### 7.7 Table of Contents
- Parsed from EPUB nav / PDF outline. Tap entry → jump. Shown as a sheet/screen from overflow.

### 7.8 In-Document Search
- Search box (from overflow). Highlights matches, prev/next navigation, match count.
- EPUB: epub.js search; PDF: PDF.js `findController`.

### 7.9 Page Thumbnails
- User can set/choose a thumbnail (cover image) for a document, shown in Library and About.
- Default: first page (PDF) / cover (EPUB). User can pick another page or a custom image.

### 7.10 Reader Settings (the "hidden" controls)
A single grouped panel (Material `List`/sheet) containing everything hidden from the reading
surface: **Theme, Font size, Font family, Font thickness, Text alignment, Hyphenation,
Page margins, Line spacing, Brightness, Table of contents, Search, Page thumbnail.** Reachable
from the reader overflow ⋮
and from global **Settings → Reader**. Controls greyed/hidden when not applicable (e.g. font
controls on PDF — see §11).

### 7.11 Highlighting (signature feature #1)
- **Long-press** a word/sentence → highlight is created and a compact **color picker** appears
  (swatches: yellow, green, blue, pink, orange + custom). Choosing a color recolors it.
- Highlights persist (anchored by EPUB **CFI** / PDF page+rect), listed in an Annotations view,
  and are tappable to recolor or delete.
- **Toggleable**: Settings → "Enable highlighting". When off, long-press does nothing special.

### 7.12 Selection → Search (signature feature #2) — ref/material.jpeg, ref/inbuilt-search.jpeg
- Selecting text raises a **draggable bottom sheet** (`@gorhom/bottom-sheet`):
  - **Collapsed (peek):** shows the selected text + chosen engine's logo + "Tap to see search
    results" (matches `ref/material.jpeg`).
  - **Expanded (drag up / tap):** full-height in-app **WebView** loading the selected text as a
    query on the configured engine (matches `ref/inbuilt-search.jpeg`). Drag down / back to
    dismiss.
- Query URL built per engine (see §8.2). If search is **disabled** in Settings, selection shows
  only copy/highlight/share actions — no search sheet.
- **Trigger rule (important):** the sheet appears **only when text is selected** (one word or
  more). It must **never** appear on a plain scroll, and—per the "Bottom sheet trigger" setting
  (§8.1)—a single *tap* on a word either (a) selects that word and opens the sheet, or (b) does
  nothing until the user makes a real selection. Scrolling never triggers it under any setting.

---

## 8. Settings (Global)

### 8.1 Toggles & Options
- **Theme** (Light / Dark / Sepia) — also in Reader Settings.
- **Enable highlighting** (on/off) — when off, removes hold-to-highlight + color picker.
- **Search engine** — radio list: **Google, DuckDuckGo, Yandex, Yahoo, Disabled**.
- **Selection bottom sheet** — master on/off. When on, a sub-option **Bottom sheet trigger**:
  - **Tap a word** — tapping a single word selects it and opens the sheet.
  - **On selection only** *(default)* — sheet opens only when the user explicitly selects a
    word or more; a plain tap does nothing.
  - Under both, **scrolling never opens the sheet.**
- **Reading mode** — paginated vs scroll (default paginated).
- **Reader display controls** — entry to §7.10.
- **About** — app name **revpdf**, version, **Website** → `https://revpdf.in`,
  **Terms** → `https://revpdf.in/terms`, **Privacy** → `https://revpdf.in/privacy`
  (opened in the in-app browser / external browser).

### 8.2 Search engine query templates
```
Google      https://www.google.com/search?q={q}
DuckDuckGo  https://duckduckgo.com/?q={q}
Yandex      https://yandex.com/search/?text={q}
Yahoo       https://search.yahoo.com/search?p={q}
Disabled    (no search sheet; selection menu omits "search")
```
`{q}` = URL-encoded selection.

---

## 9. Data Model (expo-sqlite)

```
documents(
  id TEXT PK, title TEXT, author TEXT, format TEXT,        -- pdf|epub|doc|docx
  file_uri TEXT, size_bytes INT, thumbnail_uri TEXT,
  added_at INT, last_opened_at INT,
  progress REAL,            -- 0..1
  location TEXT,            -- CFI (epub) or page+offset (pdf)
  is_favorite INT, read_status TEXT   -- unread|reading|finished
)

highlights(
  id TEXT PK, document_id TEXT FK, color TEXT,
  anchor TEXT,              -- CFI (epub) or JSON {page, rects[]} (pdf)
  text_excerpt TEXT, created_at INT
)

bookmarks( id TEXT PK, document_id TEXT FK, location TEXT, label TEXT, created_at INT )

collections( id TEXT PK, name TEXT )
collection_items( collection_id TEXT FK, document_id TEXT FK )
```

App settings live in AsyncStorage (theme, highlightingEnabled, searchEngine, bottomSheetEnabled,
bottomSheetTrigger `tap|selection`, readingMode, and typography defaults: fontFamily, fontSize,
fontWeight, textAlign, hyphenation, pageMargins `on|off`, lineSpacing `0–100`).

---

## 10. UI / Material Design Guidelines
- **react-native-paper** MD3 components: `Appbar`, `List`, `Card`, `FAB`, `SegmentedButtons`
  (theme & alignment pickers), `Slider`, `Switch`, `RadioButton`, `BottomSheet`/`Modal`.
- Material **dynamic color** where available; otherwise a fixed seed palette per theme.
- Minimalism: generous whitespace, no decorative chrome, icons over labels in the reader, content
  is the hero. Reading surface has **zero** persistent UI.
- Touch targets ≥ 48dp; respect safe areas and Android navigation/gesture bars.

---

## 11. Reflowable vs Fixed-Layout Behavior Matrix

| Control | EPUB / DOCX (reflow) | PDF (fixed) |
|---|---|---|
| Theme (light/dark/sepia) | ✅ full restyle | ✅ background tint + invert option |
| Font size | ✅ | ❌ (use zoom instead) |
| Font family / weight | ✅ | ❌ |
| Text align / hyphenation | ✅ | ❌ |
| Brightness | ✅ | ✅ |
| Zoom / pinch | n/a (font size) | ✅ |
| TOC / outline | ✅ | ✅ if outline present |
| In-doc search | ✅ | ✅ (text layer) |
| Highlight (hold) | ✅ CFI | ✅ page+rect overlay |
| Selection → search | ✅ | ✅ |
| Page thumbnail | ✅ cover | ✅ any page |

Controls that don't apply are hidden/disabled in Reader Settings for that document.

---

## 12. Permissions
- Storage / file access for importing documents (`expo-document-picker` handles SAF on Android).
- Write settings for `expo-brightness` (Android `WRITE_SETTINGS` may be requested for system
  brightness; prefer app-window brightness which needs no special permission).
- Internet (in-app search WebView).

---

## 13. Roadmap / Milestones

**M1 — Skeleton**
- Expo + dev client, expo-router, Paper MD3 theming (light/dark/sepia), navigation map.

**M2 — Library & Import**
- Document import, SQLite, Library shelf, About Document, thumbnails (default).

**M3 — Reader core**
- WebView reader bundle: EPUB (epub.js) + PDF (PDF.js), pagination/scroll, progress persistence,
  chrome-free surface with center-tap minimal bar.

**M4 — Typography & display**
- Reader Settings panel: font size/family/weight, align, hyphenation, brightness, theme,
  reflow-vs-fixed gating.

**M5 — Signature interactions**
- Hold-to-highlight + color picker + persistence; selection bottom sheet (peek → expand) with
  configurable search engine.

**M6 — TOC, search, thumbnails, polish**
- In-document search, TOC, custom page thumbnails, settings completeness, empty/error states.

**M7 — Hardening**
- DOC/DOCX conversion robustness, large-file performance, edge cases, accessibility pass.

---

## 14. Open Questions
1. **Font "Alic"** — assumed to mean **Alice** (Google serif font). Confirm. v1 bundled set is
   Alice / Comfortaa / Merriweather / Roboto / Noto Serif / Original.
2. **Legacy `.doc`** — no reliable client-side parser. Options: (a) skip `.doc`, support only
   `.docx`; (b) bundle a heavier converter; (c) optional server-side convert. Recommend (a) for v1.
3. **Reader controls access** — requirement says display controls are "hidden when reading, accessed
   via settings." Spec uses a center-tap minimal bar + overflow → Reader Settings. Confirm whether
   you want a quick "Aa" affordance in that bar, or *strictly* only inside global Settings.
4. **Reading mode default** — paginated (book-like) vs continuous scroll as the default?
5. **Highlight anchoring for PDF** — store normalized page rects; confirm reflow on zoom is
   acceptable (overlays recompute on scale).
6. **Annotations management** — is an Annotations/Highlights list screen wanted in v1, or just
   inline tap-to-edit?

---

## 15. Out of Scope (v1)
Dictionary, translation, TTS/read-aloud, cloud sync/accounts, DRM formats, annotation export,
multi-window/tablet-optimized layouts.
