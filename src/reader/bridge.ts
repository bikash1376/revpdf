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
  background: string;
  text: string;
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

// ---- WebView → RN ----
export type OutboundMessage =
  | { type: 'ready' }
  | { type: 'loaded'; toc: TocItem[]; chapterCount: number }
  | { type: 'location'; cfi: string; progress: number; chapter: string }
  | { type: 'tap'; zone: 'left' | 'center' | 'right' }
  | { type: 'selection'; text: string; cfiRange: string }
  | { type: 'selectionCleared' }
  | { type: 'searchResults'; query: string; count: number }
  | { type: 'error'; message: string };

export function parseOutbound(raw: string): OutboundMessage | null {
  try {
    const msg = JSON.parse(raw);
    if (msg && typeof msg.type === 'string') return msg as OutboundMessage;
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
  addHighlight: (id: string, cfiRange: string, color: string) =>
    call('addHighlight', id, cfiRange, color),
  removeHighlight: (id: string) => call('removeHighlight', id),
  renderHighlights: (items: { id: string; cfiRange: string; color: string }[]) =>
    call('renderHighlights', items),
  search: (query: string) => call('search', query),
  clearSelection: () => call('clearSelection'),
};
