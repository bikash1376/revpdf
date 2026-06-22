import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Dimensions, Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, IconButton, Text, useTheme } from 'react-native-paper';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { SEARCH_ENGINES, type OpenLinksIn, type SearchEngine } from '@/store/settings';
import { highlightColors } from '@/theme/tokens';

const SCREEN_H = Dimensions.get('window').height;

// Peek height that comfortably shows the handle + header row + the highlight
// swatch row, so colors are tappable without expanding the sheet.
const PEEK = 168;

export type Selection = { text: string; cfiRange: string };

type Props = {
  selection: Selection | null;
  searchEngine: SearchEngine;
  openLinksIn: OpenLinksIn;
  highlightingEnabled: boolean;
  canHighlight: boolean;
  onHighlight: (color: string) => void;
  onDismiss: () => void;
};

function hostOf(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return '';
  }
}

/**
 * Chrome-style selection sheet (spec §7.12). On selection it opens at a peek
 * showing the selected text + highlight colors, with search results already
 * loaded underneath. Drag the handle to a middle breakpoint (hold) or full.
 * Result links act like a mini in-app browser; back steps through history and
 * finally returns to the reader.
 */
export function SelectionSheet({
  selection,
  searchEngine,
  openLinksIn,
  highlightingEnabled,
  canHighlight,
  onHighlight,
  onDismiss,
}: Props) {
  const theme = useTheme();
  const sheetRef = useRef<BottomSheet>(null);
  const webRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);

  const searchEnabled = searchEngine !== 'disabled';
  const url = useMemo(() => {
    if (!selection || !searchEnabled) return null;
    return SEARCH_ENGINES[searchEngine].url(encodeURIComponent(selection.text));
  }, [selection, searchEngine, searchEnabled]);
  const searchHost = useMemo(() => (url ? hostOf(url) : ''), [url]);

  // With search: peek → middle breakpoint (holdable) → near-full. Highlight-only
  // (no search): a single compact snap so there's no blank area to drag into.
  const snapPoints = useMemo(() => (url ? [PEEK, '58%', '92%'] : [PEEK]), [url]);

  useEffect(() => {
    if (selection) sheetRef.current?.snapToIndex(0);
    else sheetRef.current?.close();
  }, [selection]);

  // Hardware back: step through in-app browser history, then close (→ reader).
  useEffect(() => {
    if (!selection) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) {
        webRef.current?.goBack();
        return true;
      }
      sheetRef.current?.close();
      return true;
    });
    return () => sub.remove();
  }, [selection, canGoBack]);

  const handleClose = useCallback(() => onDismiss(), [onDismiss]);

  const onNav = useCallback((s: WebViewNavigation) => setCanGoBack(s.canGoBack), []);

  // Decide whether a navigation stays in the mini browser or hands off to the
  // system browser, based on the user's "open links in" setting.
  const onShouldStart = useCallback(
    (req: { url: string; navigationType?: string }) => {
      if (!url) return true;
      if (req.url === url) return true; // the initial search query load
      const offSite = !!searchHost && hostOf(req.url) !== searchHost;
      if (openLinksIn === 'external' && offSite) {
        WebBrowser.openBrowserAsync(req.url).catch(() => {});
        return false;
      }
      return true;
    },
    [url, searchHost, openLinksIn],
  );

  // Fully unmount when there's nothing selected — otherwise an empty sheet stays
  // mounted and can be dragged up from the bottom even when the feature is off.
  if (!selection) return null;

  const showHighlight = highlightingEnabled && canHighlight;

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      // Drag only via the handle so touches on the results page scroll the page
      // (and don't trigger the OS text-selection menu) instead of moving the sheet.
      enableContentPanningGesture={false}
      onClose={handleClose}
      backgroundStyle={{ backgroundColor: theme.colors.surface }}
      handleIndicatorStyle={{ backgroundColor: theme.colors.onSurfaceVariant }}>
      <BottomSheetView style={styles.container}>
        <View style={styles.header}>
          {canGoBack ? (
            <IconButton
              icon="arrow-left"
              size={22}
              onPress={() => webRef.current?.goBack()}
              style={styles.headerIcon}
            />
          ) : null}
          <Text
            variant="titleSmall"
            numberOfLines={1}
            style={[styles.headerText, { color: theme.colors.onSurface }]}>
            “{selection.text}”
          </Text>
          {url ? (
            <IconButton
              icon="open-in-new"
              size={22}
              onPress={() => WebBrowser.openBrowserAsync(url).catch(() => {})}
              style={styles.headerIcon}
            />
          ) : null}
          <IconButton
            icon="close"
            size={22}
            onPress={() => sheetRef.current?.close()}
            style={styles.headerIcon}
          />
        </View>

        {showHighlight ? (
          <View style={styles.swatches}>
            {highlightColors.map((c) => (
              <Pressable
                key={c.key}
                onPress={() => onHighlight(c.value)}
                hitSlop={6}
                style={[styles.swatch, { backgroundColor: c.value, borderColor: theme.colors.outline }]}
              />
            ))}
          </View>
        ) : null}

        {url ? (
          <View style={styles.webWrap}>
            <WebView
              ref={webRef}
              source={{ uri: url }}
              style={styles.web}
              onNavigationStateChange={onNav}
              onShouldStartLoadWithRequest={onShouldStart}
              setSupportMultipleWindows={false}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.loading}>
                  <ActivityIndicator />
                </View>
              )}
            />
          </View>
        ) : null}
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 4,
    gap: 4,
  },
  headerIcon: { margin: 0 },
  headerText: { flex: 1 },
  swatches: {
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 4,
  },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth },
  webWrap: { flex: 1, minHeight: SCREEN_H * 0.5, width: '100%' },
  web: { flex: 1, backgroundColor: 'transparent' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
