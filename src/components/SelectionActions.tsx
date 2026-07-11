import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Surface, useTheme } from 'react-native-paper';

import type { SelectionRect } from '@/reader/bridge';

const BTN = 46;
const GAP = 12;
const RING = 2.5;
const OFFSET = 14; // gap between the selection and the button row

type Props = {
  /** Selection bounds in WebView-viewport CSS px. */
  rect: SelectionRect;
  /** Safe-area insets of the reader surface the WebView is laid out inside. */
  insetTop: number;
  insetLeft: number;
  showHighlight: boolean;
  showSearch: boolean;
  /** Swatch shown inside the highlight button — the user's default color. */
  highlightColor: string;
  onHighlight: () => void;
  onSearch: () => void;
};

/**
 * The gradient that revolves around the search button. RN has no conic gradient,
 * so this is a linear one on an oversized square that slowly rotates behind a
 * circular clip — the visible edge reads as a sweep travelling around the ring.
 */
function RevolvingRing() {
  const theme = useTheme();
  const spin = useSharedValue(0);

  useEffect(() => {
    spin.value = withRepeat(
      withTiming(360, { duration: 2800, easing: Easing.linear }),
      -1,
      false,
    );
  }, [spin]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));

  return (
    <View style={styles.ringClip} pointerEvents="none">
      <Animated.View style={[styles.ringSpinner, style]}>
        <LinearGradient
          colors={[
            theme.colors.primary,
            theme.colors.tertiary ?? theme.colors.secondary,
            theme.colors.primary,
            'transparent',
            theme.colors.primary,
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

/**
 * The two actions that appear over a text selection (spec P1 §3): highlight with
 * the default color, and open the search sheet whose results are already loading
 * in the background.
 */
export function SelectionActions({
  rect,
  insetTop,
  insetLeft,
  showHighlight,
  showSearch,
  highlightColor,
  onHighlight,
  onSearch,
}: Props) {
  const theme = useTheme();
  const screen = Dimensions.get('window');

  if (!showHighlight && !showSearch) return null;

  const count = (showHighlight ? 1 : 0) + (showSearch ? 1 : 0);
  const barW = count * BTN + (count - 1) * GAP;

  // Prefer sitting above the selection; drop below it when the selection is
  // near the top of the screen and there's no room.
  const above = insetTop + rect.y - BTN - OFFSET;
  const top = above < insetTop + 8 ? insetTop + rect.y + rect.h + OFFSET : above;
  const left = Math.max(
    8,
    Math.min(
      screen.width - barW - 8,
      insetLeft + rect.x + rect.w / 2 - barW / 2,
    ),
  );

  return (
    <View style={[styles.row, { top, left, width: barW }]} pointerEvents="box-none">
      {showHighlight && (
        <Surface elevation={3} style={[styles.btn, { backgroundColor: theme.colors.surface }]}>
          <Pressable
            onPress={onHighlight}
            android_ripple={{ color: theme.colors.onSurface, borderless: true }}
            style={styles.press}>
            <MaterialCommunityIcons name="marker" size={22} color={theme.colors.onSurface} />
            <View style={[styles.swatch, { backgroundColor: highlightColor }]} />
          </Pressable>
        </Surface>
      )}

      {showSearch && (
        <Surface elevation={3} style={[styles.btn, { backgroundColor: theme.colors.surface }]}>
          <RevolvingRing />
          <View
            style={[styles.ringInner, { backgroundColor: theme.colors.surface }]}
            pointerEvents="none"
          />
          <Pressable
            onPress={onSearch}
            android_ripple={{ color: theme.colors.onSurface, borderless: true }}
            style={styles.press}>
            <MaterialCommunityIcons name="web" size={22} color={theme.colors.onSurface} />
          </Pressable>
        </Surface>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { position: 'absolute', flexDirection: 'row', gap: GAP },
  btn: {
    width: BTN,
    height: BTN,
    borderRadius: BTN / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  press: {
    width: BTN,
    height: BTN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Clips the spinning gradient into the button's circle.
  ringClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: BTN / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Oversized so the rotating square always covers the circle's corners.
  ringSpinner: { width: BTN * 1.6, height: BTN * 1.6 },
  // Masks out the middle, leaving only the ring visible.
  ringInner: {
    position: 'absolute',
    top: RING,
    left: RING,
    right: RING,
    bottom: RING,
    borderRadius: BTN / 2,
  },
  // Small ink dot on the highlight button showing which color it will apply.
  swatch: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
