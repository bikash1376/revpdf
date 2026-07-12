import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { ReaderThemeName } from '@/theme/tokens';
import { highlightColors, readerSurfaces, spacing } from '@/theme/tokens';

// Matches the selection cluster, so the two swap in place.
const LIFT = 38;

/**
 * Recolour / delete an existing highlight (SPEC4 §7).
 *
 * This used to live in the search bottom sheet, which meant tapping a highlight
 * dragged a whole sheet of search results up with it. It now sits where the
 * selection actions sit — bottom-right, reader-themed — and the sheet is only
 * ever about search.
 */
export function HighlightEditor({
  readerTheme,
  current,
  bottomInset,
  onPick,
  onDelete,
}: {
  readerTheme: ReaderThemeName;
  /** The highlight's present colour, so the active swatch can be marked. */
  current?: string;
  bottomInset: number;
  onPick: (color: string) => void;
  onDelete: () => void;
}) {
  const surface = readerSurfaces[readerTheme];
  // Inverted against the page, matching the selection actions.
  const bg = surface.text;
  const fg = surface.background;

  return (
    <View
      style={[
        styles.bar,
        {
          bottom: bottomInset + LIFT,
          backgroundColor: bg,
        },
      ]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.swatches}>
        {highlightColors.map((c) => (
          <Pressable
            key={c.key}
            onPress={() => onPick(c.value)}
            hitSlop={4}
            accessibilityLabel={c.label}
            style={[
              styles.swatch,
              {
                backgroundColor: c.value,
                borderColor: current === c.value ? fg : 'transparent',
                borderWidth: current === c.value ? 2.5 : 0,
              },
            ]}
          />
        ))}
      </ScrollView>

      <View style={[styles.sep, { backgroundColor: fg, opacity: 0.3 }]} />

      <Pressable onPress={onDelete} hitSlop={6} style={styles.delete}>
        <MaterialCommunityIcons name="trash-can-outline" size={22} color={fg} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    right: spacing.md,
    left: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 28,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
    height: 56,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  swatches: { alignItems: 'center', gap: 14, paddingHorizontal: spacing.xs },
  swatch: { width: 30, height: 30, borderRadius: 15 },
  sep: { width: StyleSheet.hairlineWidth, height: 28, marginHorizontal: spacing.sm },
  delete: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
