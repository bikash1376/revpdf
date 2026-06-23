import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Dimensions, Linking, Pressable, StyleSheet, View } from 'react-native';
import { ActivityIndicator, IconButton, Text, useTheme } from 'react-native-paper';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { SEARCH_ENGINES, type OpenLinksIn, type SearchEngine } from '@/store/settings';
import { highlightColors } from '@/theme/tokens';

const SCREEN_H = Dimensions.get('window').height;

// Fallback peek height (user-configurable via settings) that comfortably shows
// the handle + header row + the highlight swatch row.
const DEFAULT_PEEK = 168;

export type Selection = { text: string; cfiRange: string };

type Props = {
  selection: Selection | null;
  searchEngine: SearchEngine;
  openLinksIn: OpenLinksIn;
  highlightingEnabled: boolean;
  canHighlight: boolean;
  /** Peek height (px) the sheet opens to — user-customizable in settings. */
  peekHeight?: number;
  /** True when the selection is an existing highlight being edited (show delete). */
  canDelete?: boolean;
  onHighlight: (color: string) => void;
  onDelete?: () => void;
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
  peekHeight,
  canDelete,
  onHighlight,
  onDelete,
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

  const peek = Math.max(96, Math.round(peekHeight ?? DEFAULT_PEEK));
  // With search: peek → half (the maximum; the sheet never takes the full
  // screen). Highlight-only (no search): a single compact snap so there's no
  // blank area to drag into.
  const snapPoints = useMemo(() => (url ? [peek, '50%'] : [peek]), [url, peek]);

  // Tapping anywhere outside the sheet closes it instantly (same as the X).
  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
        opacity={0.18}
      />
    ),
    [],
  );

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

  // Open a tapped result link: in-app Custom Tab (reliable mini browser, back
  // returns here) or the system browser, per the user's setting.
  const openLink = useCallback(
    (target: string) => {
      if (openLinksIn === 'external') Linking.openURL(target).catch(() => {});
      else WebBrowser.openBrowserAsync(target).catch(() => {});
    },
    [openLinksIn],
  );

  // Keep the search engine's own pages inside the sheet (query + pagination);
  // hand result links off to openLink so a tap always does something.
  const onShouldStart = useCallback(
    (req: { url: string }) => {
      if (!url) return true;
      if (req.url === url || req.url === 'about:blank') return true;
      const h = hostOf(req.url);
      if (h && searchHost && h === searchHost) return true;
      openLink(req.url);
      return false;
    },
    [url, searchHost, openLink],
  );

  // Result links often use target="_blank"; route those through openLink too.
  const onOpenWindow = useCallback(
    (e: { nativeEvent: { targetUrl: string } }) => {
      const target = e.nativeEvent?.targetUrl;
      if (target) openLink(target);
    },
    [openLink],
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
      backdropComponent={renderBackdrop}
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
            {selection.text ? `“${selection.text}”` : 'Highlight'}
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
            {canDelete && onDelete ? (
              <Pressable
                onPress={onDelete}
                hitSlop={6}
                style={[styles.swatch, styles.deleteSwatch, { borderColor: theme.colors.outline }]}>
                <IconButton
                  icon="trash-can-outline"
                  size={18}
                  iconColor={theme.colors.error}
                  style={styles.deleteIcon}
                  pointerEvents="none"
                />
              </Pressable>
            ) : null}
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
              onOpenWindow={onOpenWindow}
              setSupportMultipleWindows
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
  deleteSwatch: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  deleteIcon: { margin: 0 },
  webWrap: { flex: 1, minHeight: SCREEN_H * 0.5, width: '100%' },
  web: { flex: 1, backgroundColor: 'transparent' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
