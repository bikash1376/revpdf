import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const W = 320; // path viewBox width — the wave is drawn twice this wide and slid
const H = 10;

/** One period of a sine wave, sampled as an SVG path. Drawn twice, end to end. */
function wavePath() {
  const pts: string[] = [];
  const step = 8;
  for (let x = 0; x <= W * 2; x += step) {
    const y = H / 2 + Math.sin((x / W) * Math.PI * 2) * (H / 2 - 1);
    pts.push(`${x === 0 ? 'M' : 'L'}${x},${y.toFixed(2)}`);
  }
  return pts.join(' ');
}

const PATH = wavePath();

/**
 * Material-style indeterminate wave. Two things move: the wave slides
 * horizontally (one full period per cycle, so it loops seamlessly), and the
 * determinate fill grows with `progress`. The result reads as "working" without
 * the generic spinner.
 */
export function WaveProgress({ progress }: { progress: number }) {
  const theme = useTheme();
  const shift = useSharedValue(0);
  const fill = useSharedValue(0);

  useEffect(() => {
    shift.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.linear }), -1, false);
  }, [shift]);

  useEffect(() => {
    fill.value = withTiming(Math.max(0, Math.min(1, progress)), { duration: 400 });
  }, [progress, fill]);

  // Slide left by exactly one period; because the path holds two periods, the
  // wave that slides in is identical to the one leaving.
  const translate = useDerivedValue(() => -shift.value * W);
  const waveStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translate.value }],
  }));
  const fillStyle = useAnimatedStyle(() => ({ width: `${fill.value * 100}%` }));

  return (
    <View style={styles.track}>
      {/* The filled portion clips the wave, so the wave only shows up to `progress`. */}
      <Animated.View style={[styles.fill, fillStyle]}>
        <Animated.View style={[styles.waveWrap, waveStyle]}>
          <Svg width={W * 2} height={H} viewBox={`0 0 ${W * 2} ${H}`}>
            <AnimatedPath
              d={PATH}
              stroke={theme.colors.primary}
              strokeWidth={2.5}
              strokeLinecap="round"
              fill="none"
            />
          </Svg>
        </Animated.View>
      </Animated.View>
      <View
        style={[styles.rail, { backgroundColor: theme.colors.surfaceVariant }]}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: H, width: '100%', justifyContent: 'center' },
  fill: { height: H, overflow: 'hidden', zIndex: 1 },
  waveWrap: { width: W * 2, height: H },
  rail: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    top: H / 2 - 1,
    borderRadius: 1,
    zIndex: 0,
  },
});
