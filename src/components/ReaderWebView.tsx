import { File } from 'expo-file-system';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import type { DocumentRow } from '@/db';
import {
  cmd,
  parseOutbound,
  type OutboundMessage,
  type ReaderTheme,
  type ReaderTypography,
} from '@/reader/bridge';
import { loadReaderHtml } from '@/reader/readerHtml';
import { useSettings } from '@/store/settings';
import { readerSurfaces, readingFonts } from '@/theme/tokens';

export type ReaderHandle = {
  next: () => void;
  prev: () => void;
  gotoCfi: (cfi: string) => void;
  gotoHref: (href: string) => void;
  search: (q: string) => void;
  findInDoc: (q: string) => void;
  findNext: () => void;
  findPrev: () => void;
  clearFind: () => void;
  addHighlight: (id: string, cfiRange: string, color: string) => void;
  removeHighlight: (id: string) => void;
  clearAllHighlights: () => void;
  clearSelection: () => void;
};

type Props = {
  doc: DocumentRow;
  highlights?: { id: string; cfiRange: string; color: string }[];
  onMessage?: (msg: OutboundMessage) => void;
};

function themeFromSettings(name: ReturnType<typeof useSettings.getState>['readerTheme']): ReaderTheme {
  const s = readerSurfaces[name];
  return { key: name, background: s.background, text: s.text, link: s.link };
}

function typographyFromSettings(s: ReturnType<typeof useSettings.getState>): ReaderTypography {
  const font = readingFonts.find((f) => f.key === s.fontFamily);
  return {
    fontStack: font?.stack ?? 'inherit',
    fontSizePct: s.fontSize,
    fontWeight: s.fontWeight,
    textAlign: s.textAlign,
    lineSpacing: s.lineSpacing,
    pageMargins: s.pageMargins,
    hyphenation: s.hyphenation,
    flow: s.readingMode === 'scroll' ? 'scrolled-doc' : 'paginated',
  };
}

export const ReaderWebView = forwardRef<ReaderHandle, Props>(function ReaderWebView(
  { doc, highlights, onMessage },
  ref,
) {
  const webRef = useRef<WebView>(null);
  const [html, setHtml] = useState<string | null>(null);
  const ready = useRef(false);
  // Becomes true on the engine's `loaded` message; gates the highlight sync so
  // we only draw once the book/spine exists (fixes highlights loaded from the
  // DB after the engine finished rendering — they used to be dropped).
  const [engineLoaded, setEngineLoaded] = useState(false);
  // id -> last drawn {cfiRange,color}, so the sync effect can diff adds/removes.
  const drawn = useRef<Map<string, { cfiRange: string; color: string }>>(new Map());

  const settings = useSettings();
  const [loading, setLoading] = useState(true);
  const theme = useMemo(() => themeFromSettings(settings.readerTheme), [settings.readerTheme]);
  const typography = useMemo(
    () => typographyFromSettings(settings),
    [
      settings.fontFamily,
      settings.fontSize,
      settings.fontWeight,
      settings.textAlign,
      settings.lineSpacing,
      settings.pageMargins,
      settings.hyphenation,
      settings.readingMode,
    ],
  );

  useImperativeHandle(ref, () => ({
    next: () => webRef.current?.injectJavaScript(cmd.next()),
    prev: () => webRef.current?.injectJavaScript(cmd.prev()),
    gotoCfi: (cfi) => webRef.current?.injectJavaScript(cmd.gotoCfi(cfi)),
    gotoHref: (href) => webRef.current?.injectJavaScript(cmd.gotoHref(href)),
    search: (q) => webRef.current?.injectJavaScript(cmd.search(q)),
    findInDoc: (q) => webRef.current?.injectJavaScript(cmd.findInDoc(q)),
    findNext: () => webRef.current?.injectJavaScript(cmd.findNext()),
    findPrev: () => webRef.current?.injectJavaScript(cmd.findPrev()),
    clearFind: () => webRef.current?.injectJavaScript(cmd.clearFind()),
    addHighlight: (id, cfiRange, color) =>
      webRef.current?.injectJavaScript(cmd.addHighlight(id, cfiRange, color)),
    removeHighlight: (id) => webRef.current?.injectJavaScript(cmd.removeHighlight(id)),
    clearAllHighlights: () => webRef.current?.injectJavaScript(cmd.clearAllHighlights()),
    clearSelection: () => webRef.current?.injectJavaScript(cmd.clearSelection()),
  }));

  useEffect(() => {
    loadReaderHtml().then(setHtml).catch(() => setHtml('<html><body></body></html>'));
  }, []);

  // Push live theme/typography updates once the engine is ready.
  useEffect(() => {
    if (ready.current) webRef.current?.injectJavaScript(cmd.applyTheme(theme));
  }, [theme]);
  useEffect(() => {
    if (ready.current) webRef.current?.injectJavaScript(cmd.applyTypography(typography));
  }, [typography]);

  // Push the native-selection-menu preference whenever it changes.
  useEffect(() => {
    if (ready.current)
      webRef.current?.injectJavaScript(cmd.setNativeMenu(settings.nativeSelectionMenu));
  }, [settings.nativeSelectionMenu]);

  // Keep the WebView's highlight overlays in sync with the DB-backed list. Runs
  // once the engine is loaded and whenever the list changes (add, recolor,
  // single delete, or clear-all), diffing against what's currently drawn.
  useEffect(() => {
    if (!engineLoaded) return;
    const next = new Map((highlights ?? []).map((h) => [h.id, h]));
    // Remove overlays no longer present.
    drawn.current.forEach((_v, id) => {
      if (!next.has(id)) {
        webRef.current?.injectJavaScript(cmd.removeHighlight(id));
        drawn.current.delete(id);
      }
    });
    // Add new overlays / redraw recolored ones.
    next.forEach((h, id) => {
      const prev = drawn.current.get(id);
      if (!prev || prev.cfiRange !== h.cfiRange || prev.color !== h.color) {
        webRef.current?.injectJavaScript(cmd.addHighlight(h.id, h.cfiRange, h.color));
        drawn.current.set(id, { cfiRange: h.cfiRange, color: h.color });
      }
    });
  }, [highlights, engineLoaded]);

  const handleReady = async () => {
    ready.current = true;
    webRef.current?.injectJavaScript(cmd.applyTheme(theme));
    webRef.current?.injectJavaScript(cmd.applyTypography(typography));
    webRef.current?.injectJavaScript(cmd.setNativeMenu(settings.nativeSelectionMenu));
    try {
      const base64 = await new File(doc.file_uri).base64();
      if (!base64.length) {
        onMessage?.({ type: 'error', message: 'This file appears to be empty — re-import it.' });
        return;
      }
      webRef.current?.injectJavaScript(cmd.loadBook(base64, doc.format, doc.location));
    } catch {
      onMessage?.({ type: 'error', message: 'Could not read the document file.' });
    }
  };

  const handleMessage = (e: WebViewMessageEvent) => {
    const msg = parseOutbound(e.nativeEvent.data);
    if (!msg) return;
    if (msg.type === 'error') console.warn('[reader]', msg.message);
    if (msg.type === 'ready') {
      handleReady();
      return;
    }
    if (msg.type === 'loaded') {
      setLoading(false);
      // Force the sync effect to (re)apply highlights now the engine is ready.
      drawn.current.clear();
      setEngineLoaded(true);
    }
    if (msg.type === 'error') setLoading(false);
    onMessage?.(msg);
  };

  if (!html) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://revpdf.local/' }}
        onMessage={handleMessage}
        style={{ flex: 1, backgroundColor: theme.background }}
        containerStyle={{ flex: 1 }}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowUniversalAccessFromFileURLs
        setSupportMultipleWindows={false}
        overScrollMode="never"
        scrollEnabled={settings.readingMode === 'scroll'}
      />
      {loading && (
        <View style={[styles.overlay, { backgroundColor: theme.background }]} pointerEvents="none">
          <ActivityIndicator color={theme.link} />
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
