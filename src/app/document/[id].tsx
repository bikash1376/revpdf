import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import {
  Appbar,
  Button,
  Dialog,
  Divider,
  IconButton,
  Portal,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DocumentCover } from '@/components/DocumentCover';
import { getDocument, renameDocument, setFavorite, type DocumentRow } from '@/db';
import { formatBytes, relativeTime } from '@/lib/format';
import { useLibrary } from '@/store/library';
import { spacing } from '@/theme/tokens';

export default function AboutDocumentScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const removeFromLibrary = useLibrary((s) => s.remove);

  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');

  const load = useCallback(async () => {
    if (id) setDoc(await getDocument(id));
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!doc) {
    return (
      <View style={[styles.screen, styles.center, { backgroundColor: theme.colors.background }]}>
        <Appbar.Header>
          <Appbar.BackAction onPress={() => router.back()} />
          <Appbar.Content title="About Document" />
        </Appbar.Header>
      </View>
    );
  }

  const progressPct = Math.round(doc.progress * 100);

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header elevated>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content title="About Document" />
        <Button mode="text" onPress={() => router.push(`/reader/${doc.id}`)}>
          READ
        </Button>
      </Appbar.Header>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 24 }}>
        <View style={styles.coverWrap}>
          <DocumentCover uri={doc.thumbnail_uri} format={doc.format} width={150} height={206} />
        </View>

        <Text variant="headlineSmall" style={styles.title}>
          {doc.title}
        </Text>
        {doc.author ? (
          <Text variant="titleSmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {doc.author}
          </Text>
        ) : null}

        <Text
          variant="bodyMedium"
          style={[styles.meta, { color: theme.colors.onSurfaceVariant }]}>
          {doc.format.toUpperCase()} · {formatBytes(doc.size_bytes)}
        </Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {progressPct}% · {doc.last_opened_at ? `opened ${relativeTime(doc.last_opened_at)}` : 'not opened yet'}
        </Text>

        <Divider style={styles.divider} />

        <View style={styles.actionRow}>
          <Action
            icon={doc.is_favorite ? 'star' : 'star-outline'}
            label="Favorite"
            active={!!doc.is_favorite}
            onPress={async () => {
              await setFavorite(doc.id, !doc.is_favorite);
              load();
            }}
          />
          <Action
            icon="pencil-outline"
            label="Rename"
            onPress={() => {
              setDraftTitle(doc.title);
              setRenaming(true);
            }}
          />
          <Action
            icon="share-variant-outline"
            label="Share"
            onPress={() => Share.share({ url: doc.file_uri, title: doc.title })}
          />
          <Action
            icon="delete-outline"
            label="Delete"
            onPress={() => setConfirmDelete(true)}
          />
        </View>

        <Button
          mode="contained"
          icon="book-open-variant"
          style={styles.readButton}
          onPress={() => router.push(`/reader/${doc.id}`)}>
          {doc.progress > 0 ? 'Continue reading' : 'Read'}
        </Button>
      </ScrollView>

      <Portal>
        <Dialog visible={renaming} onDismiss={() => setRenaming(false)}>
          <Dialog.Title>Rename</Dialog.Title>
          <Dialog.Content>
            <TextInput value={draftTitle} onChangeText={setDraftTitle} autoFocus mode="outlined" />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRenaming(false)}>Cancel</Button>
            <Button
              onPress={async () => {
                const t = draftTitle.trim();
                if (t) await renameDocument(doc.id, t);
                setRenaming(false);
                load();
              }}>
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={confirmDelete} onDismiss={() => setConfirmDelete(false)}>
          <Dialog.Title>Delete document?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              This removes “{doc.title}” and its highlights from revpdf. The local copy is deleted.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              textColor={theme.colors.error}
              onPress={async () => {
                setConfirmDelete(false);
                await removeFromLibrary(doc.id);
                router.back();
              }}>
              Delete
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

function Action({
  icon,
  label,
  active,
  onPress,
}: {
  icon: string;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.action}>
      <IconButton
        icon={icon}
        size={24}
        onPress={onPress}
        iconColor={active ? theme.colors.primary : theme.colors.onSurfaceVariant}
      />
      <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { justifyContent: 'flex-start' },
  coverWrap: { alignItems: 'center', marginBottom: spacing.lg },
  title: { marginBottom: spacing.xs },
  meta: { marginTop: spacing.sm },
  divider: { marginVertical: spacing.lg },
  actionRow: { flexDirection: 'row', justifyContent: 'space-around' },
  action: { alignItems: 'center' },
  readButton: { marginTop: spacing.xl, borderRadius: 999 },
});
