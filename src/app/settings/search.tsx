import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Appbar, Button, Dialog, List, Portal, RadioButton, Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SEARCH_ENGINES, type SearchEngine, useSettings } from '@/store/settings';
import { spacing } from '@/theme/tokens';

// Planned AI-powered selection answers — not wired up yet.
const COMING_SOON: { key: string; label: string; description: string; icon: string }[] = [
  { key: 'ai', label: 'AI', description: 'Ask AI about your selection', icon: 'robot-outline' },
  {
    key: 'ai-byok',
    label: 'AI · BYOK',
    description: 'Use your own API key',
    icon: 'key-outline',
  },
];

const OPTIONS: { value: SearchEngine; label: string }[] = [
  { value: 'google', label: 'Google' },
  { value: 'duckduckgo', label: 'DuckDuckGo' },
  { value: 'yandex', label: 'Yandex' },
  { value: 'yahoo', label: 'Yahoo' },
  { value: 'disabled', label: 'Disabled' },
];

export default function SearchEngineScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const searchEngine = useSettings((s) => s.searchEngine);
  const set = useSettings((s) => s.set);
  const [comingSoon, setComingSoon] = useState<string | null>(null);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header elevated>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content title="Search engine" />
      </Appbar.Header>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <RadioButton.Group
          value={searchEngine}
          onValueChange={(v) => set('searchEngine', v as SearchEngine)}>
          {OPTIONS.map((o) => (
            <RadioButton.Item key={o.value} label={o.label} value={o.value} />
          ))}
        </RadioButton.Group>

        {COMING_SOON.map((o) => (
          <List.Item
            key={o.key}
            title={o.label}
            description={o.description}
            left={(p) => <List.Icon {...p} icon={o.icon} />}
            right={(p) => (
              <Text {...p} variant="labelSmall" style={{ color: theme.colors.primary, alignSelf: 'center' }}>
                Soon
              </Text>
            )}
            onPress={() => setComingSoon(o.label)}
          />
        ))}

        <Text
          variant="bodySmall"
          style={{
            color: theme.colors.onSurfaceVariant,
            paddingHorizontal: spacing.lg,
            marginTop: spacing.sm,
          }}>
          When you select text, the bottom sheet searches your selection with this engine. Choose
          “Disabled” to remove search from the selection menu.
        </Text>
      </ScrollView>

      <Portal>
        <Dialog visible={!!comingSoon} onDismiss={() => setComingSoon(null)}>
          <Dialog.Title>Coming soon</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              {comingSoon} answers for your selection aren’t available yet — they’re on the way.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setComingSoon(null)}>Got it</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}
