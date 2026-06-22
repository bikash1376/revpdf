import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Divider, List, SegmentedButtons, Switch, Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SEARCH_ENGINES, useSettings } from '@/store/settings';
import { spacing } from '@/theme/tokens';

const SITE = 'https://revpdf.in';

export default function SettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const s = useSettings();

  const searchLabel =
    s.searchEngine === 'disabled' ? 'Disabled' : SEARCH_ENGINES[s.searchEngine].label;
  const triggerLabel =
    s.bottomSheetTrigger === 'tap' ? 'Tap a word' : 'On selection only';

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

        <List.Item
          title="Reader display controls"
          description="Font, size, alignment, spacing, margins, brightness"
          left={(p) => <List.Icon {...p} icon="format-font" />}
          right={(p) => <List.Icon {...p} icon="chevron-right" />}
          onPress={() => router.push('/settings/reader')}
        />

        <Divider />
        <List.Subheader>Selection &amp; search</List.Subheader>

        <List.Item
          title="Highlighting"
          description="Long-press text to highlight and pick a color"
          left={(p) => <List.Icon {...p} icon="marker" />}
          right={() => (
            <Switch
              value={s.highlightingEnabled}
              onValueChange={(v) => s.set('highlightingEnabled', v)}
            />
          )}
        />

        <List.Item
          title="Selection bottom sheet"
          description="Show a search sheet when you select text"
          left={(p) => <List.Icon {...p} icon="dock-bottom" />}
          right={() => (
            <Switch
              value={s.bottomSheetEnabled}
              onValueChange={(v) => s.set('bottomSheetEnabled', v)}
            />
          )}
        />

        {s.bottomSheetEnabled && (
          <View style={styles.indent}>
            <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>
              When does it open?
            </Text>
            <SegmentedButtons
              value={s.bottomSheetTrigger}
              onValueChange={(v) => s.set('bottomSheetTrigger', v as typeof s.bottomSheetTrigger)}
              style={styles.segmentInline}
              buttons={[
                { value: 'selection', label: 'On selection' },
                { value: 'tap', label: 'Tap a word' },
              ]}
            />
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Scrolling never opens the sheet.
            </Text>
          </View>
        )}

        <List.Item
          title="Search engine"
          description={searchLabel}
          left={(p) => <List.Icon {...p} icon="magnify" />}
          right={(p) => <List.Icon {...p} icon="chevron-right" />}
          onPress={() => router.push('/settings/search')}
        />

        <View style={styles.indent}>
          <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>
            Open links
          </Text>
          <SegmentedButtons
            value={s.openLinksIn}
            onValueChange={(v) => s.set('openLinksIn', v as typeof s.openLinksIn)}
            style={styles.segmentInline}
            buttons={[
              { value: 'in-app', label: 'In app', icon: 'application-outline' },
              { value: 'external', label: 'Browser', icon: 'open-in-new' },
            ]}
          />
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            Where result links open: a mini browser inside revpdf, or your phone’s browser.
          </Text>
        </View>

        <Divider />
        <List.Subheader>Reading</List.Subheader>
        <View style={styles.segmentWrap}>
          <SegmentedButtons
            value={s.readingMode}
            onValueChange={(v) => s.set('readingMode', v as typeof s.readingMode)}
            buttons={[
              { value: 'paginated', label: 'Paginated', icon: 'book-open-outline' },
              { value: 'scroll', label: 'Scroll', icon: 'arrow-down' },
            ]}
          />
        </View>

        <Divider />
        <View style={styles.aboutLogo}>
          <Image
            source={require('@/assets/images/revpdf-logo.png')}
            style={styles.logo}
            contentFit="contain"
          />
        </View>
        <List.Subheader>About</List.Subheader>
        <List.Item
          title="revpdf"
          description={`Version ${Constants.expoConfig?.version ?? '1.0.0'}`}
          left={(p) => <List.Icon {...p} icon="information-outline" />}
        />
        <List.Item
          title="Supported formats"
          description="Reads PDF and EPUB. DOCX, Markdown, TXT, HTML, JSON and CSV are planned."
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
  segmentInline: { marginVertical: spacing.sm },
  indent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: 4 },
  aboutLogo: { alignItems: 'center', paddingTop: spacing.lg, paddingBottom: spacing.xs },
  logo: { width: 168, height: 57 },
  builtBy: { textAlign: 'center', marginTop: spacing.lg },
  footer: { textAlign: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.lg },
});
