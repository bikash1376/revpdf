import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Menu } from 'react-native-paper';

import type { ReaderThemeName } from '@/theme/tokens';
import { readerSurfaces, spacing } from '@/theme/tokens';

const BTN = 48;
const GAP = 12;
const RING = 2.5;

type Props = {
  /** Drives the button colours — the READER surface, never the app theme. */
  readerTheme: ReaderThemeName;
  showHighlight: boolean;
  showSearch: boolean;
  /** Ink dot on the highlight button: the colour one tap will apply. */
  highlightColor: string;
  /** Distance from the bottom of the reader, so the cluster clears the nav bar. */
  bottomInset: number;
  onHighlight: () => void;
  onSearch: () => void;
  onCopy: () => void;
  onShare: () => void;
  onSelectAll: () => void;
};

/**
 * The revolving gradient on the search button. RN has no conic gradient, so this
 * is a linear one on an oversized square rotating behind a circular clip — the
 * visible edge reads as a sweep travelling around the ring.
 */
function RevolvingRing({ surface }: { surface: string }) {
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
    <>
      <View style={styles.ringClip} pointerEvents="none">
        <Animated.View style={[styles.ringSpinner, style]}>
          <LinearGradient
            colors={['#4285F4', '#9B72F2', '#4285F4', 'transparent', '#4285F4']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </View>
      {/* Masks the middle so only the ring shows. */}
      <View
        style={[styles.ringInner, { backgroundColor: surface }]}
        pointerEvents="none"
      />
    </>
  );
}

/**
 * The actions for a live text selection (SPEC4 §1–§4).
 *
 * Parked in the bottom-right rather than floating over the selected text, so it
 * never covers the words you're looking at. Colours come from the reader surface
 * so the buttons read black-on-white on a light page and white-on-black on a
 * dark one, regardless of the app's own theme.
 *
 * Copy / Share / Select all live in the overflow: our selection engine has to
 * suppress Android's selection bar to draw its own handles, so those actions
 * would otherwise be unreachable.
 */
export function SelectionActions({
  readerTheme,
  showHighlight,
  showSearch,
  highlightColor,
  bottomInset,
  onHighlight,
  onSearch,
  onCopy,
  onShare,
  onSelectAll,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const surface = readerSurfaces[readerTheme];

  const run = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };

  return (
    <View
      style={[styles.cluster, { bottom: bottomInset + spacing.lg }]}
      pointerEvents="box-none">
      {showHighlight && (
        <Pressable
          onPress={onHighlight}
          style={[styles.btn, { backgroundColor: surface.surface, borderColor: surface.outline }]}
          android_ripple={{ color: surface.text, borderless: true }}>
          <MaterialCommunityIcons name="marker" size={23} color={surface.text} />
          <View style={[styles.swatch, { backgroundColor: highlightColor }]} />
        </Pressable>
      )}

      {showSearch && (
        <Pressable
          onPress={onSearch}
          style={[styles.btn, { backgroundColor: surface.surface, borderColor: surface.outline }]}
          android_ripple={{ color: surface.text, borderless: true }}>
          <RevolvingRing surface={surface.surface} />
          <MaterialCommunityIcons name="web" size={23} color={surface.text} />
        </Pressable>
      )}

      <Menu
        visible={menuOpen}
        onDismiss={() => setMenuOpen(false)}
        anchor={
          <Pressable
            onPress={() => setMenuOpen(true)}
            style={[styles.btn, { backgroundColor: surface.surface, borderColor: surface.outline }]}
            android_ripple={{ color: surface.text, borderless: true }}>
            <MaterialCommunityIcons name="dots-vertical" size={23} color={surface.text} />
          </Pressable>
        }>
        <Menu.Item leadingIcon="content-copy" title="Copy" onPress={run(onCopy)} />
        <Menu.Item leadingIcon="share-variant" title="Share" onPress={run(onShare)} />
        <Menu.Item leadingIcon="select-all" title="Select all" onPress={run(onSelectAll)} />
      </Menu>
    </View>
  );
}

const styles = StyleSheet.create({
  cluster: {
    position: 'absolute',
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: GAP,
  },
  btn: {
    width: BTN,
    height: BTN,
    borderRadius: BTN / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    // Reader surfaces are flat colours, so lift the cluster off the page with a
    // shadow rather than an MD3 elevation tint (which would fight the theme).
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  ringClip: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: BTN / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Oversized so the rotating square always covers the circle's corners.
  ringSpinner: { width: BTN * 1.6, height: BTN * 1.6 },
  ringInner: {
    position: 'absolute',
    top: RING,
    left: RING,
    right: RING,
    bottom: RING,
    borderRadius: BTN / 2,
  },
  swatch: {
    position: 'absolute',
    right: 9,
    bottom: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
