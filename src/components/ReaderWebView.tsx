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
  addHighlight: (id: string, cfiRange: string, color: string) => void;
  removeHighlight: (id: string) => void;
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
    addHighlight: (id, cfiRange, color) =>
      webRef.current?.injectJavaScript(cmd.addHighlight(id, cfiRange, color)),
    removeHighlight: (id) => webRef.current?.injectJavaScript(cmd.removeHighlight(id)),
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

  const handleReady = async () => {
    ready.current = true;
    webRef.current?.injectJavaScript(cmd.applyTheme(theme));
    webRef.current?.injectJavaScript(cmd.applyTypography(typography));
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
      if (highlights?.length) webRef.current?.injectJavaScript(cmd.renderHighlights(highlights));
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
