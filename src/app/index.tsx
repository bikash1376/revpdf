import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import {
  Appbar,
  Button,
  Dialog,
  Divider,
  FAB,
  Portal,
  Searchbar,
  Text,
  useTheme,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DocumentListItem } from '@/components/DocumentListItem';
import type { DocumentRow } from '@/db';
import { useLibrary } from '@/store/library';
import { spacing } from '@/theme/tokens';

export default function LibraryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { documents, importing, refresh, importFiles, remove, toggleFavorite } = useLibrary();

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuDoc, setMenuDoc] = useState<DocumentRow | null>(null);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
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
          <Appbar.Content title="Welcome back" />
          <Appbar.Action icon="magnify" onPress={() => setSearchOpen(true)} />
          <Appbar.Action icon="cog-outline" onPress={() => router.push('/settings')} />
        </Appbar.Header>
      )}

      <FlatList
        data={filtered}
        keyExtractor={(d) => d.id}
        contentContainerStyle={
          filtered.length === 0 ? styles.emptyContainer : { paddingBottom: insets.bottom + 96 }
        }
        ItemSeparatorComponent={Divider}
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
            <Image
              source={require('@/assets/images/revpdf-logo.png')}
              style={styles.emptyLogo}
              contentFit="contain"
            />
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
  emptyLogo: { width: 200, height: 68, marginBottom: spacing.md },
  emptySub: { textAlign: 'center', marginBottom: spacing.sm },
  fab: { position: 'absolute', right: spacing.md },
});
