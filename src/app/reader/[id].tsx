import * as Brightness from 'expo-brightness';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Appbar, IconButton, Menu, Snackbar, Text, TextInput, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReaderWebView, type ReaderHandle } from '@/components/ReaderWebView';
import { SelectionSheet } from '@/components/SelectionSheet';
import {
  addHighlight,
  deleteHighlight,
  getDocument,
  listHighlights,
  updateHighlightColor,
  updateProgress,
  type DocumentRow,
} from '@/db';
import type { OutboundMessage, TocItem } from '@/reader/bridge';
import { useSettings } from '@/store/settings';
import { readerSurfaces } from '@/theme/tokens';

export default function ReaderScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const surface = readerSurfaces[settings.readerTheme];

  const { id } = useLocalSearchParams<{ id: string }>();
  const readerRef = useRef<ReaderHandle>(null);

  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [highlights, setHighlights] = useState<{ id: string; cfiRange: string; color: string }[]>([]);
  // Start with the toolbar visible so the title + menu are reachable on open;
  // a center tap hides it for immersive reading.
  const [chrome, setChrome] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [progress, setProgress] = useState(0);
  const [selection, setSelection] = useState<{ text: string; cfiRange: string } | null>(null);
  // Set when the open sheet is editing an existing highlight (recolor / delete).
  const [editingHl, setEditingHl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // In-document search.
  const [findActive, setFindActive] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findInfo, setFindInfo] = useState<{ count: number; index: number }>({ count: 0, index: -1 });

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      getDocument(id).then(setDoc);
      listHighlights(id).then((rows) =>
        setHighlights(rows.map((r) => ({ id: r.id, cfiRange: r.anchor, color: r.color }))),
      );
    }, [id]),
  );

  // Per-reader brightness (spec §7.6): apply on entry, restore on exit.
  useFocusEffect(
    useCallback(() => {
      if (settings.brightness !== null) {
        Brightness.setBrightnessAsync(settings.brightness).catch(() => {});
      }
      return () => {
        Brightness.restoreSystemBrightnessAsync().catch(() => {});
      };
    }, [settings.brightness]),
  );

  const persist = (p: number, cfi: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (id) updateProgress(id, p, cfi);
    }, 600);
  };

  const onMessage = (msg: OutboundMessage) => {
    switch (msg.type) {
      case 'loaded':
        setToc(msg.toc);
        break;
      case 'location':
        setProgress(msg.progress);
        persist(msg.progress, msg.cfi);
        break;
      case 'tap':
        // Any tap inside the content toggles chrome; page-turns use the edge
        // zones (overlaid in RN) which are reliable across engines.
        setChrome((v) => !v);
        break;
      case 'link': {
        // A hyperlink tapped inside the document. mailto:/tel: always go to the
        // OS handler; http(s) honors the "Open links in" setting.
        const useSystem =
          settings.openLinksIn === 'external' || /^(mailto:|tel:)/i.test(msg.href);
        if (useSystem) Linking.openURL(msg.href).catch(() => {});
        else WebBrowser.openBrowserAsync(msg.href).catch(() => {});
        break;
      }
      case 'selection':
        if (settings.bottomSheetEnabled || settings.highlightingEnabled) {
          setEditingHl(null);
          setSelection({ text: msg.text, cfiRange: msg.cfiRange });
        }
        break;
      case 'highlightTapped':
        // Tapped an existing highlight → open the sheet to recolor / delete it.
        if (!settings.highlightingEnabled) break;
        setEditingHl(msg.id);
        setSelection({ text: '', cfiRange: msg.cfiRange });
        break;
      case 'selectionCleared':
        setSelection(null);
        setEditingHl(null);
        break;
      case 'findResults':
        setFindInfo({ count: msg.count, index: msg.index });
        break;
      case 'error':
        setError(msg.message);
        break;
    }
  };

  const canHighlight = !!selection?.cfiRange; // EPUB only (PDF has no CFI anchor yet)

  const doHighlight = async (color: string) => {
    if (!selection || !id || !selection.cfiRange) return;
    if (editingHl) {
      // Recolor the existing highlight in place.
      readerRef.current?.removeHighlight(editingHl);
      readerRef.current?.addHighlight(editingHl, selection.cfiRange, color);
      await updateHighlightColor(editingHl, color);
      setHighlights((hs) => hs.map((h) => (h.id === editingHl ? { ...h, color } : h)));
    } else {
      const hid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      readerRef.current?.addHighlight(hid, selection.cfiRange, color);
      await addHighlight({
        id: hid,
        document_id: id,
        color,
        anchor: selection.cfiRange,
        text_excerpt: selection.text.slice(0, 280),
        created_at: Date.now(),
      });
      setHighlights((hs) => [{ id: hid, cfiRange: selection.cfiRange, color }, ...hs]);
    }
    readerRef.current?.clearSelection();
    setSelection(null);
    setEditingHl(null);
  };

  const doDeleteHighlight = async () => {
    if (!editingHl) return;
    readerRef.current?.removeHighlight(editingHl);
    await deleteHighlight(editingHl);
    setHighlights((hs) => hs.filter((h) => h.id !== editingHl));
    readerRef.current?.clearSelection();
    setSelection(null);
    setEditingHl(null);
  };

  const dismissSelection = () => {
    readerRef.current?.clearSelection();
    setSelection(null);
    setEditingHl(null);
  };

  const closeFind = () => {
    setFindActive(false);
    setFindQuery('');
    setFindInfo({ count: 0, index: -1 });
    readerRef.current?.clearFind();
  };

  if (!doc) {
    return (
      <View style={[styles.screen, { backgroundColor: surface.background }]}>
        <View style={[styles.center, { paddingTop: insets.top }]}>
          <Text style={{ color: surface.textSecondary }}>Loading…</Text>
        </View>
      </View>
    );
  }

  return (
    // The safe-area strips (status bar / nav bar) follow the APP theme, not the
    // reader surface — otherwise a light reader theme (light/sepia) under a dark
    // app theme paints a light status-bar strip with the app's light-on-dark
    // status icons over it, which looks broken. The document itself is painted
    // by the WebView inside the inset content area, so it stays reader-themed.
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.reader, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <ReaderWebView ref={readerRef} doc={doc} highlights={highlights} onMessage={onMessage} />
      </View>

      {/* Edge tap-zones for reliable page turns (paginated reflowable formats). */}
      {doc.format !== 'pdf' &&
        settings.readingMode === 'paginated' &&
        !chrome &&
        !selection &&
        !findActive && (
        <>
          <Pressable
            style={[styles.pageZone, { left: 0, top: insets.top + 56, bottom: insets.bottom + 56 }]}
            onPress={() => readerRef.current?.prev()}
          />
          <Pressable
            style={[styles.pageZone, { right: 0, top: insets.top + 56, bottom: insets.bottom + 56 }]}
            onPress={() => readerRef.current?.next()}
          />
        </>
      )}

      {chrome && !findActive && (
        <View style={[styles.topBar, { paddingTop: insets.top }]} pointerEvents="box-none">
          <Appbar.Header style={{ backgroundColor: theme.colors.surface }} elevated>
            <Appbar.BackAction onPress={() => router.back()} />
            <Appbar.Content title={doc.title} titleStyle={styles.title} />
            <Appbar.Action
              icon="magnify"
              onPress={() => {
                setFindActive(true);
                setChrome(true);
              }}
            />
            <Menu
              visible={menuOpen}
              onDismiss={() => setMenuOpen(false)}
              anchor={<Appbar.Action icon="dots-vertical" onPress={() => setMenuOpen(true)} />}>
              <Menu.Item
                leadingIcon="magnify"
                title="Find in document"
                onPress={() => {
                  setMenuOpen(false);
                  setFindActive(true);
                }}
              />
              <Menu.Item
                leadingIcon="format-font"
                title="Reader settings"
                onPress={() => {
                  setMenuOpen(false);
                  router.push(`/settings/reader?format=${doc.format}&id=${doc.id}`);
                }}
              />
              <Menu.Item
                leadingIcon="table-of-contents"
                title={`Contents${toc.length ? ` (${toc.length})` : ''}`}
                disabled={toc.length === 0}
                onPress={() => {
                  setMenuOpen(false);
                  // Contents UI lands in M6; jump to first entry for now if present.
                  if (toc[0]) readerRef.current?.gotoHref(toc[0].href);
                }}
              />
            </Menu>
          </Appbar.Header>
        </View>
      )}

      {findActive && (
        <View style={[styles.topBar, { paddingTop: insets.top }]}>
          <Appbar.Header style={{ backgroundColor: theme.colors.surface }} elevated>
            <Appbar.BackAction onPress={closeFind} />
            <TextInput
              mode="flat"
              dense
              autoFocus
              placeholder="Find in document"
              value={findQuery}
              onChangeText={setFindQuery}
              onSubmitEditing={() => readerRef.current?.findInDoc(findQuery)}
              returnKeyType="search"
              underlineColor="transparent"
              activeUnderlineColor="transparent"
              style={styles.findInput}
            />
            <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant, minWidth: 40 }}>
              {findInfo.count > 0 ? `${findInfo.index + 1}/${findInfo.count}` : findQuery ? '0' : ''}
            </Text>
            <Appbar.Action icon="chevron-up" onPress={() => readerRef.current?.findPrev()} />
            <Appbar.Action icon="chevron-down" onPress={() => readerRef.current?.findNext()} />
          </Appbar.Header>
        </View>
      )}

      {chrome && (
        <View
          style={[styles.bottomBar, { paddingBottom: insets.bottom, backgroundColor: theme.colors.surface }]}
          pointerEvents="box-none">
          <IconButton icon="chevron-left" onPress={() => readerRef.current?.prev()} />
          <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            {Math.round(progress * 100)}%
          </Text>
          <IconButton icon="chevron-right" onPress={() => readerRef.current?.next()} />
        </View>
      )}

      <Snackbar visible={!!error} onDismiss={() => setError(null)} duration={5000}>
        {error ?? ''}
      </Snackbar>

      {/* Chrome-style selection → search sheet (auto-loads results). */}
      <SelectionSheet
        selection={settings.bottomSheetEnabled || settings.highlightingEnabled ? selection : null}
        searchEngine={
          editingHl ? 'disabled' : settings.bottomSheetEnabled ? settings.searchEngine : 'disabled'
        }
        openLinksIn={settings.openLinksIn}
        highlightingEnabled={settings.highlightingEnabled}
        canHighlight={canHighlight}
        peekHeight={settings.selectionPeekHeight}
        canDelete={!!editingHl}
        onHighlight={doHighlight}
        onDelete={doDeleteHighlight}
        onDismiss={dismissSelection}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  reader: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  title: { fontSize: 16 },
  findInput: { flex: 1, height: 44, backgroundColor: 'transparent' },
  pageZone: { position: 'absolute', width: '16%' },
});
