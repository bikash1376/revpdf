import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Dimensions, Linking, StyleSheet, View } from 'react-native';
import { ActivityIndicator, IconButton, Text, useTheme } from 'react-native-paper';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { SEARCH_ENGINES, type OpenLinksIn, type SearchEngine } from '@/store/settings';

const SCREEN_H = Dimensions.get('window').height;

export type Selection = { text: string; cfiRange: string };

type Props = {
  selection: Selection | null;
  /**
   * Whether the sheet is raised. When false but `selection` is set, the sheet
   * stays mounted just off-screen so its WebView loads the results in the
   * background — tapping the search action then raises a sheet that's already
   * populated instead of a spinner.
   */
  open: boolean;
  searchEngine: SearchEngine;
  openLinksIn: OpenLinksIn;
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
 * Open the sheet *on the results* (SPEC4 §8).
 *
 * A search engine spends the top of its page on a logo, a search box and the
 * query you just typed — all of which you already know. In a half-height sheet
 * that's most of the visible area. So we scroll past it.
 *
 * Two mechanisms, because the chrome comes in two kinds. `headerTrim` (a
 * per-engine px offset — they each waste a different amount) scrolls the static
 * masthead out of the way. The generic sweep then hides anything that computes
 * to fixed/sticky and is pinned to the top, which is what the engines use for
 * the search bar that would otherwise follow us down. Selector-free, so an
 * engine reskinning its results page degrades to the old behaviour rather than
 * breaking the sheet.
 */
function trimScript(px: number) {
  return `(function(){
    function trim(){
      try {
        document.querySelectorAll('body *').forEach(function(el){
          var p = getComputedStyle(el).position;
          if ((p === 'fixed' || p === 'sticky') && el.getBoundingClientRect().top < 8
              && el.offsetHeight > 0 && el.offsetHeight < 240) {
            el.style.display = 'none';
          }
        });
        window.scrollTo(0, ${px});
      } catch (e) {}
    }
    trim();
    // Results pages hydrate late, so re-apply as the layout settles.
    setTimeout(trim, 300);
    setTimeout(trim, 900);
    setTimeout(trim, 1800);
  })(); true;`;
}

/**
 * Selection → search sheet. Raised by the search action, already loaded.
 * Result links act like a mini in-app browser; back steps through history and
 * finally returns to the reader.
 */
export function SelectionSheet({
  selection,
  open,
  searchEngine,
  openLinksIn,
  onDismiss,
}: Props) {
  const theme = useTheme();
  const sheetRef = useRef<BottomSheet>(null);
  const webRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  // The sheet also sits at index -1 while prefetching, and that isn't a
  // dismissal — so only treat a close as one once it has actually been raised.
  const raised = useRef(false);

  const searchEnabled = searchEngine !== 'disabled';
  const engine = searchEnabled ? SEARCH_ENGINES[searchEngine] : null;
  const url = useMemo(() => {
    if (!selection || !engine) return null;
    return engine.url(encodeURIComponent(selection.text));
  }, [selection, engine]);
  const searchHost = useMemo(() => (url ? hostOf(url) : ''), [url]);

  // One snap point: the sheet opens straight to its full height. It used to open
  // at a peek and expect the reader to drag it up to see anything.
  const snapPoints = useMemo(() => ['55%'], []);

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
    if (selection && open) {
      raised.current = true;
      sheetRef.current?.snapToIndex(0);
    } else if (!selection) {
      sheetRef.current?.close();
    }
  }, [selection, open]);

  // Hardware back: step through in-app browser history, then close (→ reader).
  // Only while raised — a prefetching sheet must not swallow the back button.
  useEffect(() => {
    if (!selection || !open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) {
        webRef.current?.goBack();
        return true;
      }
      sheetRef.current?.close();
      return true;
    });
    return () => sub.remove();
  }, [selection, open, canGoBack]);

  const handleClose = useCallback(() => {
    if (!raised.current) return; // settling into the prefetch position, not a dismiss
    raised.current = false;
    onDismiss();
  }, [onDismiss]);

  const onNav = useCallback((s: WebViewNavigation) => setCanGoBack(s.canGoBack), []);

  const openLink = useCallback(
    (target: string) => {
      if (openLinksIn === 'external') Linking.openURL(target).catch(() => {});
      else WebBrowser.openBrowserAsync(target).catch(() => {});
    },
    [openLinksIn],
  );

  // Keep the engine's own pages inside the sheet (query + pagination); hand
  // result links off so a tap always does something.
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

  const onOpenWindow = useCallback(
    (e: { nativeEvent: { targetUrl: string } }) => {
      const target = e.nativeEvent?.targetUrl;
      if (target) openLink(target);
    },
    [openLink],
  );

  // Fully unmount when nothing is selected, so an empty sheet can't be dragged
  // up from the bottom when the feature is off.
  if (!selection || !url || !engine) return null;

  const trim = trimScript(engine.headerTrim);

  return (
    <BottomSheet
      ref={sheetRef}
      // Starts closed: the WebView below still mounts and loads, which is what
      // makes the results already be there when the sheet is raised.
      index={-1}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      // Drag only via the handle, so touches on the results scroll the page
      // instead of moving the sheet.
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
            {`“${selection.text}”`}
          </Text>
          <IconButton
            icon="open-in-new"
            size={22}
            onPress={() => WebBrowser.openBrowserAsync(url).catch(() => {})}
            style={styles.headerIcon}
          />
          <IconButton
            icon="close"
            size={22}
            onPress={() => sheetRef.current?.close()}
            style={styles.headerIcon}
          />
        </View>

        <View style={styles.webWrap}>
          <WebView
            ref={webRef}
            source={{ uri: url }}
            style={styles.web}
            onNavigationStateChange={onNav}
            onShouldStartLoadWithRequest={onShouldStart}
            onOpenWindow={onOpenWindow}
            setSupportMultipleWindows
            // Runs on every navigation, so pagination and "related searches"
            // land on the results too — not just the first load.
            injectedJavaScript={trim}
            onLoadEnd={() => webRef.current?.injectJavaScript(trim)}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loading}>
                <ActivityIndicator />
              </View>
            )}
          />
        </View>
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
  webWrap: { flex: 1, minHeight: SCREEN_H * 0.45, width: '100%' },
  web: { flex: 1, backgroundColor: 'transparent' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
