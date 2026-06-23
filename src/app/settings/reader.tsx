import Slider from '@react-native-community/slider';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import {
  Appbar,
  Button,
  Chip,
  Dialog,
  Divider,
  List,
  Portal,
  SegmentedButtons,
  Switch,
  Text,
  useTheme,
} from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { clearHighlights, countHighlights } from '@/db';
import { useSettings } from '@/store/settings';
import { readerSurfaces, readingFonts, spacing, type ReadingFontKey } from '@/theme/tokens';

const PREVIEW =
  'Material Design is Google’s open-source design system for building beautiful, usable products. revpdf keeps the page in front and the controls out of the way.';

// Approximate the bundled web fonts with platform faces for the native preview.
const SERIF_FONTS: ReadingFontKey[] = ['alice', 'merriweather', 'notoSerif'];

export default function ReaderSettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const s = useSettings();
  const surface = readerSurfaces[s.readerTheme];
  // When opened from inside a PDF, font face/size don't apply (fixed layout) —
  // fade those controls out. Reflowable formats (and the global entry from
  // Settings, where no format is passed) keep them active.
  const { format, id } = useLocalSearchParams<{ format?: string; id?: string }>();
  const isPdf = format === 'pdf';

  // Highlight management is per-document, so it only shows when this screen was
  // opened from inside a reader (an `id` was passed).
  const [hlCount, setHlCount] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    if (id) countHighlights(id).then(setHlCount).catch(() => setHlCount(0));
  }, [id]);

  const doClearAll = async () => {
    if (id) await clearHighlights(id);
    setHlCount(0);
    setConfirmClear(false);
  };

  const previewFontFamily =
    s.fontFamily === 'original'
      ? undefined
      : SERIF_FONTS.includes(s.fontFamily)
        ? Platform.select({ ios: 'Georgia', default: 'serif' })
        : Platform.select({ ios: 'System', default: 'sans-serif' });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header elevated>
        <Appbar.BackAction onPress={() => router.back()} />
        <Appbar.Content title="Reader" />
      </Appbar.Header>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {/* live preview */}
        <View style={[styles.preview, { backgroundColor: surface.surface, borderColor: surface.outline }]}>
          <Text
            style={{
              color: surface.text,
              fontSize: 16 * (s.fontSize / 100),
              fontWeight: String(s.fontWeight) as any,
              lineHeight: 16 * (s.fontSize / 100) * (1.2 + (s.lineSpacing / 100) * 0.8),
              textAlign: s.textAlign,
              fontFamily: previewFontFamily,
              paddingHorizontal: s.pageMargins ? spacing.lg : spacing.xs,
            }}>
            {PREVIEW}
          </Text>
        </View>

        <Text variant="bodySmall" style={[styles.note, { color: theme.colors.onSurfaceVariant }]}>
          This theme only changes the page you read — the app's own theme lives in Settings →
          Appearance. Font, alignment, spacing and margins apply to reflowable formats (EPUB). PDF
          keeps its fixed layout — pinch to zoom; theme, brightness, highlight and search apply there.
        </Text>

        <List.Subheader>Reader theme</List.Subheader>
        <View style={styles.block}>
          <SegmentedButtons
            value={s.readerTheme}
            onValueChange={(v) => s.set('readerTheme', v as typeof s.readerTheme)}
            buttons={[
              { value: 'light', label: 'Light' },
              { value: 'sepia', label: 'Sepia' },
              { value: 'twilight', label: 'Twilight' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </View>

        <List.Subheader>Font</List.Subheader>
        <View style={[styles.chips, isPdf && styles.disabled]} pointerEvents={isPdf ? 'none' : 'auto'}>
          {readingFonts.map((f) => (
            <Chip
              key={f.key}
              selected={s.fontFamily === f.key}
              showSelectedCheck
              disabled={isPdf}
              onPress={() => s.set('fontFamily', f.key)}>
              {f.label}
            </Chip>
          ))}
        </View>

        <View style={isPdf ? styles.disabled : undefined} pointerEvents={isPdf ? 'none' : 'auto'}>
          <SliderRow
            label="Font size"
            value={s.fontSize}
            min={80}
            max={200}
            step={5}
            suffix="%"
            onChange={(v) => s.set('fontSize', v)}
          />
        </View>

        <List.Subheader>Thickness</List.Subheader>
        <View style={styles.block}>
          <SegmentedButtons
            value={String(s.fontWeight)}
            onValueChange={(v) => s.set('fontWeight', Number(v))}
            buttons={[
              { value: '300', label: 'Light' },
              { value: '400', label: 'Regular' },
              { value: '500', label: 'Medium' },
              { value: '700', label: 'Bold' },
            ]}
          />
        </View>

        <List.Subheader>Alignment</List.Subheader>
        <View style={styles.block}>
          <SegmentedButtons
            value={s.textAlign}
            onValueChange={(v) => s.set('textAlign', v as typeof s.textAlign)}
            buttons={[
              { value: 'left', icon: 'format-align-left' },
              { value: 'center', icon: 'format-align-center' },
              { value: 'right', icon: 'format-align-right' },
              { value: 'justify', icon: 'format-align-justify' },
            ]}
          />
        </View>

        <SliderRow
          label="Line spacing"
          value={s.lineSpacing}
          min={0}
          max={100}
          step={5}
          suffix="%"
          onChange={(v) => s.set('lineSpacing', v)}
        />

        <List.Item
          title="Hyphenation"
          left={(p) => <List.Icon {...p} icon="format-text" />}
          right={() => (
            <Switch value={s.hyphenation} onValueChange={(v) => s.set('hyphenation', v)} />
          )}
        />
        <List.Item
          title="Page margins"
          left={(p) => <List.Icon {...p} icon="format-page-break" />}
          right={() => (
            <Switch value={s.pageMargins} onValueChange={(v) => s.set('pageMargins', v)} />
          )}
        />

        <Divider style={{ marginVertical: spacing.sm }} />
        <List.Item
          title="Brightness follows system"
          left={(p) => <List.Icon {...p} icon="brightness-auto" />}
          right={() => (
            <Switch
              value={s.brightness === null}
              onValueChange={(v) => s.set('brightness', v ? null : 0.7)}
            />
          )}
        />
        {s.brightness !== null && (
          <SliderRow
            label="Brightness"
            value={Math.round(s.brightness * 100)}
            min={10}
            max={100}
            step={5}
            suffix="%"
            onChange={(v) => s.set('brightness', v / 100)}
          />
        )}

        {id ? (
          <>
            <Divider style={{ marginVertical: spacing.sm }} />
            <List.Subheader>Highlights</List.Subheader>
            <List.Item
              title="Clear all highlights"
              description={
                hlCount === null
                  ? 'Loading…'
                  : hlCount === 0
                    ? 'No highlights in this document'
                    : `Remove all ${hlCount} highlight${hlCount === 1 ? '' : 's'} from this document`
              }
              left={(p) => <List.Icon {...p} icon="marker-cancel" />}
              disabled={!hlCount}
              onPress={() => setConfirmClear(true)}
            />
          </>
        ) : null}
      </ScrollView>

      <Portal>
        <Dialog visible={confirmClear} onDismiss={() => setConfirmClear(false)}>
          <Dialog.Title>Clear all highlights?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              This permanently removes every highlight in this document. This can’t be undone.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmClear(false)}>Cancel</Button>
            <Button textColor={theme.colors.error} onPress={doClearAll}>
              Clear all
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.sliderRow}>
      <View style={styles.sliderHeader}>
        <Text variant="labelLarge" style={{ color: theme.colors.onSurface }}>
          {label}
        </Text>
        <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>
          {value}
          {suffix}
        </Text>
      </View>
      <Slider
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onValueChange={onChange}
        minimumTrackTintColor={theme.colors.primary}
        maximumTrackTintColor={theme.colors.surfaceVariant}
        thumbTintColor={theme.colors.primary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    margin: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  note: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  block: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.md },
  disabled: { opacity: 0.4 },
  sliderRow: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between' },
});
