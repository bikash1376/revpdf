# revpdf — Version 2 Roadmap

Turning revpdf into a **multipurpose, local-first reader** that still stays small.
Companion to [`SPEC.md`](./SPEC.md). Status of v1 lives in [`PHASES.md`](./PHASES.md).

---

## A. Multipurpose format support

Goal: one app that opens documents, data, and markup — each rendered in the existing
WebView engine via a **format → renderer registry** (`src/reader/renderers/<fmt>.ts`), so
adding a format is a small, isolated change.

| Format | Approach | Library | Added size | Effort | Notes |
|---|---|---|---|---|---|
| **PDF** ✅ | PDF.js canvas + text layer | pdfjs (vendored) | ~1.3 MB worker | done | already shipping |
| **EPUB** ✅ | epub.js | epubjs + jszip | ~0.3 MB | done | already shipping |
| **TXT** ✅ | reflow renderer (paragraphs) | none | ~0 | done | shipped |
| **Markdown** ✅ | `marked` → HTML → reflow renderer | marked (~100 KB) | ~100 KB | done | **shipped + verified on device** |
| **HTML (rendered)** ✅ | reflow renderer (script-stripped) | none | ~0 | done | shipped (raw-source toggle still TODO) |
| **JSON** ✅ | pretty-print `<pre>` | none | ~0 | done | shipped (collapsible tree = future) |
| **CSV** ✅ | parse → HTML table | tiny custom | ~0 | done | shipped (sort = future) |
| **DOCX** | DOCX → HTML → reflow renderer | `mammoth` (~150 KB) | ~150 KB | M | reflowable; images inline |
| **XLSX** | parse → sheet tabs → tables | SheetJS `xlsx` (**~900 KB**) | **~0.9 MB** | M | heaviest — load lazily / on demand |
| DOC (legacy) | best-effort or skip | — | — | L | recommend skip in v2 |

**Design:** a `Renderer` interface — `{ canHandle(fmt), html(), onLoad(book) }`. The WebView
shell stays generic; each renderer injects only what it needs. Selection/highlight/search/theme
bridges already exist and are reused by every reflowable renderer (MD/HTML/DOCX/TXT).

**Honest current state:** only **PDF** and **EPUB** actually render today. DOC/DOCX appear in the
import picker but are **not yet rendered** (the engine reports them unsupported) — fixing that is
part of this roadmap, not a v1 claim.

---

## B. Keeping the app small (this is a first-class requirement)

The two biggest levers, in order of payoff:

1. ✅ **Strip bundled icon fonts.** Done — importing `@expo/vector-icons/MaterialCommunityIcons`
   directly drops the other ~19 TTFs. Verified in export: only `MaterialCommunityIcons.ttf`
   bundles now (**~3.5–4 MB saved**).
2. **Split the reader bundle per format & load lazily.** Today `reader.html` inlines epub.js +
   jszip + pdf.js + worker = **1.7 MB**, loaded even for a TXT file. Instead ship a tiny shell and
   fetch each engine's JS only when that format is first opened (Metro asset or local require).
   EPUB readers don't pay the PDF.js 1.3 MB, etc.
3. **Lazy-load heavy parsers.** SheetJS (~0.9 MB) and mammoth (~150 KB) load **on demand**, never
   at startup.
4. **Release build hygiene:** R8/ProGuard minify + resource shrinking, Hermes (already on),
   `enableProguardInReleaseBuilds`, drop unused locales, `expo-optimize`/sharp asset compression.
5. **Reconsider PDF engine.** Native PDF (e.g. pdf-rendering via a config-plugin) could drop the
   1.3 MB pdf.js worker — but loses the shared text-layer/selection model. Keep pdf.js unless size
   becomes critical; revisit.
6. **APK split by ABI** (`enableSeparateBuildPerCPUArchitecture`) so users download one arch, not all.

Target: keep the base install lean; heavy engines are pulled only when a user actually opens that
format.

---

## C. Premium features (what paid readers gate — and we can do locally)

ReadEra Premium / Moon+ Reader Pro / KOReader-style extras, ranked by value-for-effort:

**High value**
- **Reading statistics** — time read, pages/day, streaks, per-book and total (all local).
- **Annotations hub** — all highlights/notes/bookmarks in one searchable screen; **export** to
  Markdown/TXT/HTML (Moon+/ReadEra gate export).
- **Full-text search across the whole library** (not just in-document).
- **Text-to-speech / read-aloud** with sentence highlighting (`expo-speech`).
- **Auto-scroll reading** with adjustable speed.
- **Per-book settings** — remember theme/font/brightness per document.

**Medium value**
- **Custom themes** — user-defined background/text colors + a true-black AMOLED theme + adjustable
  warmth/blue-light filter (timed).
- **PDF tools** — crop/trim margins, reflow text from PDF, two-page/landscape, page jump grid.
- **Collections / tags / shelves**, favorites, reading status filters; **reading goals**.
- **Page-flip animations** (curl/slide) and tap/volume-key page turns.
- **Bookmarks with thumbnails** and a quick "resume" carousel on the home screen.

**Nice to have / power users**
- **OPDS catalog** browsing (Gutenberg, Standard Ebooks) — optional, online.
- **Optional sync/backup** via WebDAV / Google Drive / a single export-import `.zip` (stays
  opt-in; default remains fully local).
- **RTL + vertical text + manga/comic (CBZ/CBR)** mode.
- **Handwriting / ink annotations** on PDF.
- **Home-screen widgets** ("continue reading"), Quick-Settings tile.
- **Citation export** (BibTeX) for academic PDFs/EPUBs.

**Signature differentiators (lean into what makes revpdf unique)**
- The **selection → search sheet** is already a standout — extend it: multi-engine quick-switch
  chips in the sheet, "search within book" vs "search web" toggle, and a Wikipedia/define mode.
- **Markdown-native reading** of your own notes alongside books (no other reader treats `.md` as a
  first-class book) — pairs perfectly with making this multipurpose.

---

## D. Suggested build order for v2

1. **Format registry refactor** + **TXT/Markdown/JSON/CSV/HTML** (cheap, small, high utility).
2. **Size pass** — strip icon fonts, split/lazy-load engines (do this *with* step 1 so it never
   regresses).
3. **DOCX** (mammoth, lazy).
4. **Annotations hub + export** and **library-wide search**.
5. **Reading stats** + **TTS** + **auto-scroll**.
6. **XLSX** (lazy, opt-in) and **custom themes / AMOLED / warmth**.
7. Polish: per-book settings, collections/tags, page-flip, widgets.

---

## E. Known v1 issues to fix first (carry-over)
- ✅ **Edge-tap pagination** — fixed: page turns now use RN edge tap-zones (reliable across
  engines); center stays for selection/chrome. Verified on device.
- ✅ **Font family** — fixed: the 5 reading fonts are bundled as `@font-face` (latin woff2,
  ~120 KB) and injected into EPUB chapter iframes. Verified (Comfortaa renders rounded).
- ✅ **Import 0-byte copies** — fixed earlier (legacy `copyAsync` + size validation).
- ⬜ **DOCX** rendering (currently unsupported despite picker entry) — part of section A.
