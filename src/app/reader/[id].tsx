import * as Brightness from 'expo-brightness';
import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Linking, Pressable, Share, StyleSheet, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import {
  Appbar,
  IconButton,
  Menu,
  SegmentedButtons,
  Snackbar,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HighlightEditor } from '@/components/HighlightEditor';
import { ReaderWebView, type ReaderHandle } from '@/components/ReaderWebView';
import { SelectionActions } from '@/components/SelectionActions';
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
import {
  isSafeExternalHref,
  type OutboundMessage,
  type ReaderViewMode,
  type SelectionRect,
  type TocItem,
} from '@/reader/bridge';
import { useSettings } from '@/store/settings';
import { highlightColors, readerSurfaces } from '@/theme/tokens';

type ActiveSelection = {
  text: string;
  cfiRange: string;
  /** CFI (EPUB) or JSON blob (PDF / reflow). Empty ⇒ can't be highlighted. */
  anchor: string;
  rect: SelectionRect;
};

const NO_RECT: SelectionRect = { x: 0, y: 0, w: 0, h: 0 };

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
  const [selection, setSelection] = useState<ActiveSelection | null>(null);
  // The search sheet is mounted (and loading) as soon as there's a selection, but
  // only raised once the user taps the search action — or lands here by tapping
  // an existing highlight, which needs the sheet's recolor/delete row.
  const [sheetOpen, setSheetOpen] = useState(false);
  // Set when the open sheet is editing an existing highlight (recolor / delete).
  const [editingHl, setEditingHl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // HTML documents can be read as the rendered page or as their source. Other
  // formats have only one face, so the tabs never appear for them.
  const [viewMode, setViewMode] = useState<ReaderViewMode>('rendered');
  const hasTabs = doc?.format === 'html';

  const switchView = (v: ReaderViewMode) => {
    setViewMode(v);
    readerRef.current?.setViewMode(v);
  };

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
        // A hyperlink tapped inside the document. Re-validate the scheme
        // natively (never trust the WebView) before handing it to the OS:
        // mailto:/tel: always go to the OS handler; http(s) honors the
        // "Open links in" setting.
        if (!isSafeExternalHref(msg.href)) break;
        const useSystem =
          settings.openLinksIn === 'external' || /^(mailto:|tel:)/i.test(msg.href);
        if (useSystem) Linking.openURL(msg.href).catch(() => {});
        else WebBrowser.openBrowserAsync(msg.href).catch(() => {});
        break;
      }
      case 'selection':
        if (settings.bottomSheetEnabled || settings.highlightingEnabled) {
          setEditingHl(null);
          // Actions only; the sheet stays down and prefetches its results.
          setSheetOpen(false);
          setSelection({
            text: msg.text,
            cfiRange: msg.cfiRange,
            anchor: msg.anchor,
            rect: msg.rect,
          });
        }
        break;
      case 'highlightTapped':
        // Tapped an existing highlight → swap the action cluster for the
        // recolor / delete bar. The search sheet stays out of it.
        if (!settings.highlightingEnabled) break;
        setEditingHl(msg.id);
        setSheetOpen(false);
        setSelection({ text: '', cfiRange: msg.cfiRange, anchor: msg.cfiRange, rect: NO_RECT });
        break;
      case 'selectionCleared':
        setSelection(null);
        setEditingHl(null);
        setSheetOpen(false);
        break;
      case 'findResults':
        setFindInfo({ count: msg.count, index: msg.index });
        break;
      case 'error':
        setError(msg.message);
        break;
    }
  };

  // Any format the engine could anchor — EPUB via CFI, PDF via {page,rects},
  // reflowable text via character offsets.
  const canHighlight = !!selection?.anchor;

  const defaultHighlight =
    highlightColors.find((c) => c.key === settings.defaultHighlightColor)?.value ??
    highlightColors[0].value;

  const doHighlight = async (color: string) => {
    if (!selection || !id || !selection.anchor) return;
    const anchor = selection.anchor;
    if (editingHl) {
      // Recolor the existing highlight in place.
      readerRef.current?.removeHighlight(editingHl);
      readerRef.current?.addHighlight(editingHl, anchor, color);
      await updateHighlightColor(editingHl, color);
      setHighlights((hs) => hs.map((h) => (h.id === editingHl ? { ...h, color } : h)));
    } else {
      const hid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      readerRef.current?.addHighlight(hid, anchor, color);
      await addHighlight({
        id: hid,
        document_id: id,
        color,
        anchor,
        text_excerpt: selection.text.slice(0, 280),
        created_at: Date.now(),
      });
      setHighlights((hs) => [{ id: hid, cfiRange: anchor, color }, ...hs]);
    }
    readerRef.current?.clearSelection();
    setSelection(null);
    setEditingHl(null);
    setSheetOpen(false);
  };

  const doDeleteHighlight = async () => {
    if (!editingHl) return;
    readerRef.current?.removeHighlight(editingHl);
    await deleteHighlight(editingHl);
    setHighlights((hs) => hs.filter((h) => h.id !== editingHl));
    readerRef.current?.clearSelection();
    setSelection(null);
    setEditingHl(null);
    setSheetOpen(false);
  };

  const dismissSelection = () => {
    readerRef.current?.clearSelection();
    setSelection(null);
    setEditingHl(null);
    setSheetOpen(false);
  };

  // Copy / Share / Select all. The custom selection engine has to suppress
  // Android's own selection bar in order to draw its handles, so these three
  // actions are ours to provide.
  const doCopy = async () => {
    if (!selection?.text) return;
    await Clipboard.setStringAsync(selection.text);
    dismissSelection();
    setError('Copied to clipboard');
  };

  const doShare = async () => {
    if (!selection?.text) return;
    try {
      await Share.share({ message: selection.text });
    } catch {
      // user dismissed the share sheet
    }
  };

  const doSelectAll = () => readerRef.current?.selectAll();

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

          {hasTabs && (
            <View style={[styles.tabs, { backgroundColor: theme.colors.surface }]}>
              <SegmentedButtons
                density="small"
                value={viewMode}
                onValueChange={(v) => switchView(v as ReaderViewMode)}
                buttons={[
                  { value: 'rendered', label: 'Browser', icon: 'web' },
                  { value: 'source', label: 'File', icon: 'code-tags' },
                ]}
              />
            </View>
          )}
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

      {chrome && !selection && (
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

      {/* Selection actions, parked bottom-right so they never sit on top of the
          words you're reading. Reader-themed, not app-themed. */}
      {selection && !editingHl && !sheetOpen && (
        <SelectionActions
          readerTheme={settings.readerTheme}
          bottomInset={insets.bottom}
          showHighlight={settings.highlightingEnabled && canHighlight}
          showSearch={settings.bottomSheetEnabled && settings.searchEngine !== 'disabled'}
          highlightColor={defaultHighlight}
          onHighlight={() => doHighlight(defaultHighlight)}
          onSearch={() => setSheetOpen(true)}
          onCopy={doCopy}
          onShare={doShare}
          onSelectAll={doSelectAll}
        />
      )}

      {/* Tapped an existing highlight: recolor / delete, in the same spot. */}
      {selection && editingHl && (
        <HighlightEditor
          readerTheme={settings.readerTheme}
          bottomInset={insets.bottom}
          current={highlights.find((h) => h.id === editingHl)?.color}
          onPick={doHighlight}
          onDelete={doDeleteHighlight}
        />
      )}

      {/* Search sheet. Mounts as soon as there's a selection so its results load
          in the background; the search action raises it, already full. */}
      <SelectionSheet
        selection={settings.bottomSheetEnabled && !editingHl ? selection : null}
        open={sheetOpen}
        searchEngine={settings.bottomSheetEnabled ? settings.searchEngine : 'disabled'}
        openLinksIn={settings.openLinksIn}
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
  tabs: { paddingHorizontal: 16, paddingBottom: 8 },
});
