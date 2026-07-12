# SPEC4 — selection UX, reader settings, search sheet

Follow-up to SPEC3. Everything here is a correction or refinement of what landed
on `reader-p1-p2`. No emulator testing this round — implement, then report.

---

## 1. Move the selection actions to the bottom right

**Now:** the highlight and browser buttons float directly above the selected
text, tracking it.

**Wanted:** a fixed cluster in the **bottom-right** of the reader. It does not
follow the selection. It appears when text is selected and disappears when the
selection is cleared.

Consequence: the WebView still reports the selection rect, but RN no longer uses
it for placement.

## 2. The action buttons follow the READER theme, not the app theme

The button background and the icon inside it take their colours from the
**reader** surface (`readerSurfaces[readerTheme]`), not the Paper app theme:

| Reader theme | Button background | Icon |
|---|---|---|
| Light / Sepia | light surface | dark ink |
| Dark / Twilight | dark surface | light ink |

So on a white page the icons read black; on a black page they read white. This
must not change when the *app* theme changes — only the reader theme.

## 3. Fix the text selector

Two concrete bugs:

- **Handles can't extend the selection.** Dragging either end does nothing.
- **Tapping outside doesn't deselect.** The selection stays stuck.

Root cause of the drag failure: `selPaint()` destroys and recreates the handle
elements on every repaint, and `selMoveDrag()` calls `selPaint()`. The moment
the drag begins, the node the touch was dispatched to is detached from the
document — so subsequent `touchmove` events have no ancestor path to the
`document` listener and are never delivered. The gesture dies on its first frame.

Fix: build the overlay DOM **once per host** at install time and only ever
*move* it on repaint. Never recreate a node that a live gesture is touching.
Register the touch listeners in the **capture** phase so nothing upstream
(epub.js' own swipe handling) can swallow them.

## 4. Copy / Share / Select all must exist

The custom selection engine sets `user-select: none`, which is what suppresses
Android's selection handles and floating bar — but it also means the OS
copy/share/select-all menu can never appear. Those actions still need to be
reachable.

Provide them ourselves, in an overflow menu on the selection cluster:

- **Copy** → `Clipboard.setStringAsync(selection.text)`
- **Share** → RN `Share.share({ message: selection.text })`
- **Select all** → new `RP.selectAll()` command that selects the whole
  chapter / page / article and reports it back

Drop the **Native selection menu** setting entirely. It was a toggle between two
half-working modes and the user shouldn't have to reason about it — selection is
always ours, and the three actions are always present.

## 5. The search sheet opens fully

Tapping the browser button must snap the sheet straight to its **maximum** snap
point (half the screen). No peek, no "drag me up".

Consequence: the **Selection sheet height** slider in app settings is dead —
remove it and the `selectionPeekHeight` setting.

## 6. Reader settings gets two tabs

Reader settings currently only has display controls, while things you change
just as often (search engine, highlighting, reading mode) are buried in app
settings — two screens away from the page you're reading.

Give Reader settings two tabs:

- **Display** — theme, font, size, thickness, alignment, hyphenation, margins,
  line spacing, brightness.
- **Reading** — reading mode (paginated/scroll), highlighting on/off, default
  highlight colour, selection search on/off, search engine, where links open,
  clear highlights.

App settings keeps: app theme, a link into Reader settings, and About.

## 7. Remove the highlight swatches from the bottom sheet

The sheet is for search results now; highlighting is a button. So:

- New selection → the bottom sheet shows **only** the search results.
- Tapping an **existing** highlight → does *not* open the sheet. It swaps the
  action cluster for a compact colour row + delete, in the same bottom-right
  spot.

## 8. The sheet should open *at the results*

**Now:** the sheet opens on the search engine's chrome — logo, then the search
box, then the query you already know you typed. The actual results are below the
fold of a half-height sheet.

**Wanted:** the results start at the top of the sheet. Each engine wastes a
different amount of vertical space, so this is a **per-engine** trim, not one
constant.

Approach, injected into the results WebView on load:
- Scroll down by a per-engine offset (`headerTrim` on each `SEARCH_ENGINES`
  entry).
- Additionally hide any element that computes to `position: fixed|sticky` and is
  pinned to the top — that kills the engines' sticky search bars generically,
  without brittle per-engine CSS selectors.
- Re-apply after load and on navigation, since results pages hydrate late.

Best-effort and defensive: if an engine changes its markup, the worst case is
the old behaviour, not a broken sheet.
