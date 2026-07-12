import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import {
  Appbar,
  Button,
  Dialog,
  Divider,
  FAB,
  Portal,
  Searchbar,
  Snackbar,
  Text,
  useTheme,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DocumentListItem } from '@/components/DocumentListItem';
import { FirstRun } from '@/components/onboarding/FirstRun';
import type { DocumentRow } from '@/db';
import { useLibrary } from '@/store/library';
import { useSettings } from '@/store/settings';
import { spacing } from '@/theme/tokens';
import { wordmark } from '@/theme/wordmark';

export default function LibraryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { documents, importing, loading, refresh, importFiles, remove, toggleFavorite } =
    useLibrary();

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuDoc, setMenuDoc] = useState<DocumentRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settings = useSettings();
  // The first-run pitch stands in for the empty state exactly once, and only
  // after the persisted settings have hydrated (otherwise it would flash on
  // every cold start before we know whether it's already been seen).
  const showFirstRun =
    settings._hydrated && !settings.onboardingSeen && !loading && documents.length === 0;

  // Seeing it counts as having seen it — this is the "first open" screen, not a
  // screen that nags until the user converts something.
  useEffect(() => {
    if (showFirstRun) settings.set('onboardingSeen', true);
  }, [showFirstRun, settings]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // On the library (root) screen the hardware back / gesture would exit the app.
  // When the search bar is open, intercept it to close search first instead.
  useFocusEffect(
    useCallback(() => {
      if (!searchOpen) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        setSearchOpen(false);
        setQuery('');
        return true;
      });
      return () => sub.remove();
    }, [searchOpen]),
  );

  const filtered = query
    ? documents.filter((d) => d.title.toLowerCase().includes(query.toLowerCase()))
    : documents;

  const handleImport = async () => {
    const n = await importFiles();
    if (n === 0 && documents.length === 0) {
      // nothing imported and library still empty — no-op, empty state stays
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      {searchOpen ? (
        <Appbar.Header elevated>
          <Appbar.BackAction
            onPress={() => {
              setSearchOpen(false);
              setQuery('');
            }}
          />
          <Searchbar
            placeholder="Search library"
            value={query}
            onChangeText={setQuery}
            autoFocus
            style={styles.searchbar}
            inputStyle={styles.searchInput}
            mode="view"
          />
        </Appbar.Header>
      ) : (
        <Appbar.Header elevated>
          <Appbar.Content title={showFirstRun ? 'Welcome' : 'Welcome back'} />
          {/* The first-run walkthrough (demo clip + PDF→EPUB conversion) is
              otherwise unreachable once you have documents. */}
          <Appbar.Action
            icon="help-circle-outline"
            accessibilityLabel="How RevPdf works"
            onPress={() => router.push('/onboarding')}
          />
          <Appbar.Action icon="magnify" onPress={() => setSearchOpen(true)} />
          <Appbar.Action icon="cog-outline" onPress={() => router.push('/settings')} />
        </Appbar.Header>
      )}

      {showFirstRun ? (
        <FirstRun
          onImport={handleImport}
          onOpen={(id) => router.push(`/reader/${id}`)}
          onError={setError}
        />
      ) : (
      <FlatList
        data={filtered}
        keyExtractor={(d) => d.id}
        contentContainerStyle={
          filtered.length === 0 ? styles.emptyContainer : { paddingBottom: insets.bottom + 96 }
        }
        ItemSeparatorComponent={Divider}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={refresh}
            colors={[theme.colors.primary]}
            tintColor={theme.colors.primary}
          />
        }
        renderItem={({ item }) => (
          <DocumentListItem
            doc={item}
            onPress={() => router.push(`/document/${item.id}`)}
            onToggleFavorite={() => toggleFavorite(item.id, !item.is_favorite)}
            onMore={() => setMenuDoc(item)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Image source={wordmark(theme.dark)} style={styles.emptyLogo} contentFit="contain" />
            <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
              Your library is empty
            </Text>
            <Text
              variant="bodyMedium"
              style={[styles.emptySub, { color: theme.colors.onSurfaceVariant }]}>
              Add a PDF, EPUB, or DOCX to start reading.
            </Text>
            <Button mode="contained" icon="plus" onPress={handleImport} loading={importing}>
              Add a document
            </Button>
          </View>
        }
      />
      )}

      {filtered.length > 0 && (
        <FAB
          icon="plus"
          label="Add"
          onPress={handleImport}
          loading={importing}
          style={[styles.fab, { bottom: insets.bottom + spacing.md }]}
        />
      )}

      <Portal>
        <Dialog visible={!!menuDoc} onDismiss={() => setMenuDoc(null)}>
          <Dialog.Title numberOfLines={2}>{menuDoc?.title}</Dialog.Title>
          <Dialog.Content>
            <Button
              icon="information-outline"
              onPress={() => {
                const id = menuDoc?.id;
                setMenuDoc(null);
                if (id) router.push(`/document/${id}`);
              }}>
              Details
            </Button>
            <Button
              icon={menuDoc?.is_favorite ? 'star' : 'star-outline'}
              onPress={() => {
                if (menuDoc) toggleFavorite(menuDoc.id, !menuDoc.is_favorite);
                setMenuDoc(null);
              }}>
              {menuDoc?.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
            </Button>
            <Button
              icon="delete-outline"
              textColor={theme.colors.error}
              onPress={() => {
                if (menuDoc) remove(menuDoc.id);
                setMenuDoc(null);
              }}>
              Delete
            </Button>
          </Dialog.Content>
        </Dialog>
      </Portal>

      <Snackbar visible={!!error} onDismiss={() => setError(null)} duration={6000}>
        {error ?? ''}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  searchbar: { flex: 1, backgroundColor: 'transparent', elevation: 0 },
  searchInput: { minHeight: 0 },
  emptyContainer: { flexGrow: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyLogo: { width: 200, height: 53, marginBottom: spacing.md },
  emptySub: { textAlign: 'center', marginBottom: spacing.sm },
  fab: { position: 'absolute', right: spacing.md },
});
