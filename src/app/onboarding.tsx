import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Appbar, Snackbar, useTheme } from 'react-native-paper';

import { FirstRun } from '@/components/onboarding/FirstRun';
import { useLibrary } from '@/store/library';

/**
 * The first-run experience, on demand.
 *
 * The same screen the library shows on a fresh install, reachable any time from
 * the help button — otherwise the only way to see it again (or to see it at all,
 * once you have documents) would be to clear the app's data.
 *
 * Opened this way it leads with the demo clip rather than the conversion pitch,
 * because you came here to watch, not necessarily to convert.
 */
export default function OnboardingScreen() {
  const theme = useTheme();
  const { importFiles, refresh } = useLibrary();
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    const added = await importFiles();
    if (added > 0) {
      await refresh();
      router.back();
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header elevated>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content title="How RevPdf works" />
      </Appbar.Header>

      <FirstRun
        demoUpfront
        onImport={handleImport}
        onOpen={(id) => router.replace(`/reader/${id}`)}
        onError={setError}
      />

      <Snackbar visible={!!error} onDismiss={() => setError(null)} duration={6000}>
        {error ?? ''}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
