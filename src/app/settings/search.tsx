import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Appbar, List, RadioButton, Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SEARCH_ENGINES, type SearchEngine, useSettings } from '@/store/settings';
import { spacing } from '@/theme/tokens';

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
    </View>
  );
}
