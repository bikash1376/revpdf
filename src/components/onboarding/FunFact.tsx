import { StyleSheet, View } from 'react-native';
import { Button, Card, Text, useTheme } from 'react-native-paper';

import { spacing } from '@/theme/tokens';

/**
 * The pitch, inline on the library's empty state — it sits alongside "Add a
 * document" rather than replacing it, so importing normally is still the obvious
 * first move.
 */
export function FunFact({ onTryNow, busy }: { onTryNow: () => void; busy?: boolean }) {
  const theme = useTheme();

  return (
    <Card mode="contained" style={styles.card}>
      <Card.Content style={styles.content}>
        <Text variant="labelLarge" style={{ color: theme.colors.primary }}>
          FUN FACT
        </Text>
        <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
          EPUBs are better than PDFs
        </Text>
        <View style={styles.actions}>
          <Button mode="contained" icon="autorenew" onPress={onTryNow} loading={busy}>
            Try now
          </Button>
        </View>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.lg, alignSelf: 'stretch' },
  content: { gap: spacing.xs, alignItems: 'center' },
  actions: { marginTop: spacing.sm },
});
