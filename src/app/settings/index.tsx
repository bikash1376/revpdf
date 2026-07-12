import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Divider, List, SegmentedButtons, Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSettings } from '@/store/settings';
import { spacing } from '@/theme/tokens';
import { wordmark } from '@/theme/wordmark';

const SITE = 'https://revpdf.in';

export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const s = useSettings();

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background }]}>
      <Appbar.Header elevated>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content title="Settings" />
      </Appbar.Header>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <List.Subheader>Appearance</List.Subheader>
        <View style={styles.segmentWrap}>
          <SegmentedButtons
            value={s.theme}
            onValueChange={(v) => s.set('theme', v as typeof s.theme)}
            buttons={[
              { value: 'light', label: 'Light', icon: 'white-balance-sunny' },
              { value: 'sepia', label: 'Sepia', icon: 'book-open-page-variant' },
              { value: 'dark', label: 'Dark', icon: 'weather-night' },
            ]}
          />
        </View>

        {/* Everything you change *while reading* — theme, font, reading mode,
            highlighting, search engine — lives in Reader settings, one tap from
            the page. This screen keeps only what you set once. */}
        <List.Item
          title="Reader settings"
          description="Theme, font, spacing, brightness · reading mode, highlighting, search"
          descriptionNumberOfLines={2}
          left={(p) => <List.Icon {...p} icon="format-font" />}
          right={(p) => <List.Icon {...p} icon="chevron-right" />}
          onPress={() => router.push('/settings/reader')}
        />

        <Divider />
        <View style={styles.aboutLogo}>
          <Image source={wordmark(theme.dark)} style={styles.logo} contentFit="contain" />
        </View>
        <List.Subheader>About</List.Subheader>
        <List.Item
          title="revpdf"
          description={`Version ${Constants.expoConfig?.version ?? '1.0.0'}`}
          left={(p) => <List.Icon {...p} icon="information-outline" />}
        />
        <List.Item
          title="Supported formats"
          description="PDF, EPUB, DOCX, Markdown, TXT, HTML, JSON and CSV. Legacy .doc isn’t supported — save it as .docx."
          descriptionNumberOfLines={3}
          left={(p) => <List.Icon {...p} icon="file-multiple-outline" />}
        />
        <List.Item
          title="Website"
          description="revpdf.in"
          left={(p) => <List.Icon {...p} icon="web" />}
          onPress={() => WebBrowser.openBrowserAsync(SITE)}
        />
        <List.Item
          title="Terms of Service"
          left={(p) => <List.Icon {...p} icon="file-document-outline" />}
          onPress={() => WebBrowser.openBrowserAsync(`${SITE}/terms`)}
        />
        <List.Item
          title="Privacy Policy"
          left={(p) => <List.Icon {...p} icon="shield-account-outline" />}
          onPress={() => WebBrowser.openBrowserAsync(`${SITE}/privacy`)}
        />
        <Text variant="bodyMedium" style={[styles.builtBy, { color: theme.colors.onSurfaceVariant }]}>
          Built by{' '}
          <Text
            style={{ color: theme.colors.primary }}
            onPress={() => WebBrowser.openBrowserAsync('https://bksh.site')}>
            Bikash
          </Text>
        </Text>
        <Text variant="bodySmall" style={[styles.footer, { color: theme.colors.onSurfaceVariant }]}>
          Everything stays on this device. revpdf has no accounts and no servers.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  segmentWrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  aboutLogo: { alignItems: 'center', paddingTop: spacing.lg, paddingBottom: spacing.xs },
  logo: { width: 168, height: 45 },
  builtBy: { textAlign: 'center', marginTop: spacing.lg },
  footer: { textAlign: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.lg },
});
