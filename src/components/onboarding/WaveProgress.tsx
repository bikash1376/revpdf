import { useEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

// Material 3 wavy linear progress indicator.
// https://m3.material.io/components/progress-indicators/specs
const H = 22; // tall enough for the wave's amplitude plus its stroke
const AMPLITUDE = 5;
const WAVELENGTH = 40;
const STROKE = 6;
const TRACK = 4; // the flat inactive track is thinner than the active wave
const GAP = 8; // MD3 leaves a gap between active and inactive
const DOT = 4; // stop indicator at the far end

/** One continuous sine, sampled. Drawn `extra` wider so it can slide seamlessly. */
function wavePath(width: number) {
  const w = width + WAVELENGTH;
  const pts: string[] = [];
  for (let x = 0; x <= w; x += 3) {
    const y = H / 2 + Math.sin((x / WAVELENGTH) * Math.PI * 2) * AMPLITUDE;
    pts.push(`${x === 0 ? 'M' : 'L'}${x},${y.toFixed(2)}`);
  }
  return pts.join(' ');
}

/**
 * The wave is a fixed drawing that slides left by exactly one wavelength, on a
 * loop — so the crest leaving the left edge is the same shape as the one
 * arriving at the right, and the motion reads as continuous. Progress is applied
 * by clipping the wave, not by redrawing it: the active track is a container
 * whose width animates, with `overflow: hidden`.
 */
export function WaveProgress({ progress }: { progress: number }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);

  const phase = useSharedValue(0);
  const value = useSharedValue(0);

  useEffect(() => {
    phase.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.linear }), -1, false);
  }, [phase]);

  useEffect(() => {
    value.value = withTiming(Math.max(0, Math.min(1, progress)), { duration: 400 });
  }, [progress, value]);

  const d = useMemo(() => (width > 0 ? wavePath(width) : ''), [width]);

  // Room for the stop dot and the gap, so a full bar doesn't collide with them.
  const usable = Math.max(0, width - GAP - DOT * 2 - 2);

  const activeStyle = useAnimatedStyle(() => ({ width: value.value * usable }));
  const waveStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -phase.value * WAVELENGTH }],
  }));
  const trackStyle = useAnimatedStyle(() => ({ left: value.value * usable + GAP }));

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View style={styles.root} onLayout={onLayout}>
      {width > 0 && (
        <>
          {/* Active: the wave, clipped to the current progress. */}
          <Animated.View style={[styles.active, activeStyle]}>
            <Animated.View style={waveStyle}>
              <Svg width={width + WAVELENGTH} height={H}>
                <Path
                  d={d}
                  stroke={theme.colors.primary}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  fill="none"
                />
              </Svg>
            </Animated.View>
          </Animated.View>

          {/* Inactive: a flat track running to just short of the stop dot. */}
          <Animated.View
            style={[
              styles.track,
              { backgroundColor: theme.colors.surfaceVariant, right: DOT * 2 + 2 },
              trackStyle,
            ]}
          />

          {/* Stop indicator. */}
          <View
            style={[styles.dot, { backgroundColor: theme.colors.primary }]}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { height: H, width: '100%', justifyContent: 'center' },
  active: { height: H, overflow: 'hidden' },
  track: {
    position: 'absolute',
    height: TRACK,
    borderRadius: TRACK / 2,
    top: (H - TRACK) / 2,
  },
  dot: {
    position: 'absolute',
    right: 0,
    width: DOT * 2,
    height: DOT * 2,
    borderRadius: DOT,
    top: (H - DOT * 2) / 2,
  },
});
