import { Pressable, StyleSheet, View } from 'react-native';
import { IconButton, ProgressBar, Text, useTheme } from 'react-native-paper';

import type { DocumentRow } from '@/db';
import { formatBytes } from '@/lib/format';
import { spacing } from '@/theme/tokens';

import { DocumentCover } from './DocumentCover';

type Props = {
  doc: DocumentRow;
  onPress: () => void;
  onToggleFavorite: () => void;
  onMore: () => void;
};

/** A library row, modeled on ReadEra's "Reading Now" shelf (ref/readera-look.jpeg). */
export function DocumentListItem({ doc, onPress, onToggleFavorite, onMore }: Props) {
  const theme = useTheme();
  const finished = doc.read_status === 'finished';

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: theme.colors.surfaceVariant }}
      style={styles.row}>
      <DocumentCover uri={doc.thumbnail_uri} format={doc.format} />

      <View style={styles.body}>
        <Text variant="titleMedium" numberOfLines={2} style={{ color: theme.colors.onSurface }}>
          {doc.title}
        </Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {doc.format.toUpperCase()}, {formatBytes(doc.size_bytes)}
        </Text>

        <ProgressBar
          progress={doc.progress}
          color={finished ? theme.colors.primary : theme.colors.secondary}
          style={styles.progress}
        />

        <View style={styles.actions}>
          <IconButton
            icon={doc.is_favorite ? 'star' : 'star-outline'}
            size={18}
            iconColor={doc.is_favorite ? theme.colors.primary : theme.colors.onSurfaceVariant}
            onPress={onToggleFavorite}
            style={styles.action}
          />
          <IconButton
            icon={finished ? 'check-all' : 'check'}
            size={18}
            iconColor={finished ? theme.colors.primary : theme.colors.onSurfaceVariant}
            disabled
            style={styles.action}
          />
          <View style={{ flex: 1 }} />
          <IconButton
            icon="dots-vertical"
            size={18}
            iconColor={theme.colors.onSurfaceVariant}
            onPress={onMore}
            style={styles.action}
          />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  progress: {
    marginTop: spacing.xs,
    height: 3,
    borderRadius: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -4,
    marginLeft: -8,
  },
  action: {
    margin: 0,
  },
});
