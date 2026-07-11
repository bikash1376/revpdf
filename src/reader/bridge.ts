/**
 * Typed message protocol between the React Native host and the in-WebView
 * reader controller (assets/reader/reader.html).
 *
 * RN → WebView: call window.RP.<fn>(...) via webview.injectJavaScript.
 * WebView → RN: postMessage(JSON.stringify(OutboundMessage)).
 */

export type DocFormat =
  | 'pdf'
  | 'epub'
  | 'doc'
  | 'docx'
  | 'txt'
  | 'md'
  | 'json'
  | 'csv'
  | 'html';

/** Reader theme tokens pushed into the document surface. */
export type ReaderTheme = {
  key: 'light' | 'dark' | 'sepia' | 'twilight';
  background: string;
  text: string;
  /** Dimmed text — used for the code view's line-number gutter. */
  textSecondary: string;
  link: string;
};

/** Typography applied to reflowable content (EPUB/DOCX). Ignored for PDF. */
export type ReaderTypography = {
  fontStack: string; // CSS font-family value, or 'inherit' for Original
  fontSizePct: number; // 80–200
  fontWeight: number; // 300–700
  textAlign: 'justify' | 'left' | 'center' | 'right';
  lineSpacing: number; // 0–100
  pageMargins: boolean;
  hyphenation: boolean;
  flow: 'paginated' | 'scrolled-doc';
};

export type TocItem = { label: string; href: string; cfi?: string };

/** Which face of a reflowable document is showing (HTML's File/Browser tabs). */
export type ReaderViewMode = 'rendered' | 'source';

/**
 * Where the selection sits, in WebView-viewport CSS px. The reader screen adds
 * its own safe-area inset to place the floating action buttons over it.
 */
export type SelectionRect = { x: number; y: number; w: number; h: number };

// ---- WebView → RN ----
export type OutboundMessage =
  | { type: 'ready' }
  | { type: 'loaded'; toc: TocItem[]; chapterCount: number }
  | { type: 'location'; cfi: string; progress: number; chapter: string }
  | { type: 'tap'; zone: 'left' | 'center' | 'right' }
  | { type: 'link'; href: string }
  /**
   * `anchor` is what gets persisted: a CFI for EPUB, or a JSON blob for PDF
   * ({page, rects}) and reflowable text ({start, end}). Empty means the
   * selection can't be anchored, so it can't be highlighted.
   */
  | { type: 'selection'; text: string; cfiRange: string; anchor: string; rect: SelectionRect }
  | { type: 'selectionCleared' }
  | { type: 'highlightTapped'; id: string; cfiRange: string }
  | { type: 'searchResults'; query: string; count: number }
  | { type: 'findResults'; query: string; count: number; index: number }
  /** PDF→EPUB conversion progress (0..1) and a human-readable stage. */
  | { type: 'convertProgress'; progress: number; stage: string }
  /** The finished EPUB, base64-encoded, ready for RN to write to disk. */
  | { type: 'converted'; base64: string }
  | { type: 'error'; message: string };

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Schemes we are willing to hand to the OS / in-app browser from a document link. */
const SAFE_LINK_SCHEME = /^(https?:|mailto:|tel:)/i;

/** Re-validate a link href natively — the WebView's own filtering can't be trusted. */
export function isSafeExternalHref(href: unknown): href is string {
  return isStr(href) && SAFE_LINK_SCHEME.test(href.trim());
}

// The WebView is a hostile boundary: a compromised/injected page can post any
// JSON. Validate each message against its typed shape and drop anything that
// doesn't match, so downstream handlers only ever see well-formed messages.
function validateOutbound(msg: any): OutboundMessage | null {
  if (!msg || typeof msg.type !== 'string') return null;
  switch (msg.type) {
    case 'ready':
    case 'selectionCleared':
      return { type: msg.type };
    case 'loaded':
      if (Array.isArray(msg.toc) && isNum(msg.chapterCount)) {
        const toc = msg.toc
          .filter((t: any) => t && isStr(t.label) && isStr(t.href))
          .map((t: any) => ({ label: t.label, href: t.href, ...(isStr(t.cfi) ? { cfi: t.cfi } : {}) }));
        return { type: 'loaded', toc, chapterCount: msg.chapterCount };
      }
      return null;
    case 'location':
      if (isStr(msg.cfi) && isNum(msg.progress) && isStr(msg.chapter))
        return { type: 'location', cfi: msg.cfi, progress: msg.progress, chapter: msg.chapter };
      return null;
    case 'tap':
      if (msg.zone === 'left' || msg.zone === 'center' || msg.zone === 'right')
        return { type: 'tap', zone: msg.zone };
      return null;
    case 'link':
      // Only surface links with a scheme we consider safe to open.
      if (isSafeExternalHref(msg.href)) return { type: 'link', href: msg.href.trim() };
      return null;
    case 'selection': {
      if (!isStr(msg.text) || !isStr(msg.cfiRange)) return null;
      const r = msg.rect;
      if (!r || !isNum(r.x) || !isNum(r.y) || !isNum(r.w) || !isNum(r.h)) return null;
      return {
        type: 'selection',
        text: msg.text,
        cfiRange: msg.cfiRange,
        anchor: isStr(msg.anchor) ? msg.anchor : '',
        rect: { x: r.x, y: r.y, w: r.w, h: r.h },
      };
    }
    case 'highlightTapped':
      if (isStr(msg.id) && isStr(msg.cfiRange))
        return { type: 'highlightTapped', id: msg.id, cfiRange: msg.cfiRange };
      return null;
    case 'searchResults':
      if (isStr(msg.query) && isNum(msg.count))
        return { type: 'searchResults', query: msg.query, count: msg.count };
      return null;
    case 'findResults':
      if (isStr(msg.query) && isNum(msg.count) && isNum(msg.index))
        return { type: 'findResults', query: msg.query, count: msg.count, index: msg.index };
      return null;
    case 'convertProgress':
      if (isNum(msg.progress) && isStr(msg.stage))
        return { type: 'convertProgress', progress: msg.progress, stage: msg.stage };
      return null;
    case 'converted':
      // Base64 only — this string gets written to disk, so reject anything that
      // isn't the alphabet we expect.
      if (isStr(msg.base64) && /^[A-Za-z0-9+/=\s]+$/.test(msg.base64))
        return { type: 'converted', base64: msg.base64 };
      return null;
    case 'error':
      if (isStr(msg.message)) return { type: 'error', message: msg.message };
      return null;
    default:
      return null;
  }
}

export function parseOutbound(raw: string): OutboundMessage | null {
  try {
    return validateOutbound(JSON.parse(raw));
  } catch {
    // ignore malformed
  }
  return null;
}

// ---- RN → WebView command builders (return JS to inject) ----
const call = (fn: string, ...args: unknown[]) =>
  `window.RP && window.RP.${fn}(${args.map((a) => JSON.stringify(a)).join(',')}); true;`;

export const cmd = {
  loadBook: (base64: string, format: DocFormat, location: string | null) =>
    call('loadBook', base64, format, location),
  applyTheme: (theme: ReaderTheme) => call('applyTheme', theme),
  applyTypography: (typo: ReaderTypography) => call('applyTypography', typo),
  next: () => call('next'),
  prev: () => call('prev'),
  gotoCfi: (cfi: string) => call('gotoCfi', cfi),
  gotoHref: (href: string) => call('gotoHref', href),
  /** `anchor`: a CFI (EPUB) or a JSON anchor blob (PDF / reflowable text). */
  addHighlight: (id: string, anchor: string, color: string) =>
    call('addHighlight', id, anchor, color),
  removeHighlight: (id: string) => call('removeHighlight', id),
  renderHighlights: (items: { id: string; cfiRange: string; color: string }[]) =>
    call('renderHighlights', items),
  clearAllHighlights: () => call('clearAllHighlights'),
  setNativeMenu: (enabled: boolean) => call('setNativeMenu', enabled),
  /** HTML File/Browser tabs: 'rendered' = the page, 'source' = highlighted markup. */
  setViewMode: (view: ReaderViewMode) => call('setViewMode', view),
  convertPdfToEpub: (base64: string, title: string) =>
    call('convertPdfToEpub', base64, title),
  search: (query: string) => call('search', query),
  findInDoc: (query: string) => call('findInDoc', query),
  findNext: () => call('findNext'),
  findPrev: () => call('findPrev'),
  clearFind: () => call('clearFind'),
  clearSelection: () => call('clearSelection'),
};
