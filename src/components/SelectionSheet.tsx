import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, IconButton, Text, useTheme } from 'react-native-paper';
import { WebView } from 'react-native-webview';

import { SEARCH_ENGINES, type SearchEngine } from '@/store/settings';
import { highlightColors } from '@/theme/tokens';

const SCREEN_H = Dimensions.get('window').height;

export type Selection = { text: string; cfiRange: string };

type Props = {
  selection: Selection | null;
  searchEngine: SearchEngine;
  highlightingEnabled: boolean;
  canHighlight: boolean;
  onHighlight: (color: string) => void;
  onDismiss: () => void;
};

/**
 * Chrome-style selection sheet (spec §7.12, ref/material.jpeg + inbuilt-search.jpeg).
 * On selection it opens at a peek showing the text + engine, with the search results
 * WebView already loaded underneath — drag up to see full results.
 */
export function SelectionSheet({
  selection,
  searchEngine,
  highlightingEnabled,
  canHighlight,
  onHighlight,
  onDismiss,
}: Props) {
  const theme = useTheme();
  const sheetRef = useRef<BottomSheet>(null);

  const searchEnabled = searchEngine !== 'disabled';
  const url = useMemo(() => {
    if (!selection || !searchEnabled) return null;
    return SEARCH_ENGINES[searchEngine].url(encodeURIComponent(selection.text));
  }, [selection, searchEngine, searchEnabled]);

  // With search results: small peek that expands to near-full. Highlight-only
  // (no search): a single compact snap so there's no big blank area to drag into.
  const snapPoints = useMemo(() => (url ? [84, '92%'] : [148]), [url]);

  useEffect(() => {
    if (selection) sheetRef.current?.snapToIndex(0);
    else sheetRef.current?.close();
  }, [selection]);

  const handleClose = useCallback(() => onDismiss(), [onDismiss]);

  // Fully unmount when there's nothing selected — otherwise an empty sheet stays
  // mounted and can be dragged up from the bottom even when the feature is off.
  if (!selection) return null;

  const showHighlight = highlightingEnabled && canHighlight;

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={handleClose}
      backgroundStyle={{ backgroundColor: theme.colors.surface }}
      handleIndicatorStyle={{ backgroundColor: theme.colors.onSurfaceVariant }}>
      <BottomSheetView style={styles.container}>
        <View style={styles.header}>
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
              onPress={() => WebBrowser.openBrowserAsync(url)}
            />
          ) : null}
          <IconButton icon="close" size={22} onPress={() => sheetRef.current?.close()} />
        </View>

        {showHighlight ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.swatches}>
            {highlightColors.map((c) => (
              <Pressable
                key={c.key}
                onPress={() => onHighlight(c.value)}
                style={[styles.swatch, { backgroundColor: c.value, borderColor: theme.colors.outline }]}
              />
            ))}
          </ScrollView>
        ) : null}

        {url ? (
          <View style={[styles.webWrap, { height: SCREEN_H * 0.9 }]}>
            <WebView
              source={{ uri: url }}
              style={styles.web}
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
    gap: 8,
  },
  headerText: { flex: 1 },
  swatches: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingBottom: 12, paddingTop: 2 },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth },
  webWrap: { width: '100%' },
  web: { flex: 1, backgroundColor: 'transparent' },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
