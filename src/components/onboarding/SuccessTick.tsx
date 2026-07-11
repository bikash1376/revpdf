import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const SIZE = 96;
const R = 42;
const CIRC = 2 * Math.PI * R;
// The checkmark, in the circle's coordinate space.
const TICK = 'M30,49 L43,62 L67,36';
const TICK_LEN = 60;

/**
 * The Google-Pay-style confirmation: the ring draws itself, then the tick
 * strokes on and the whole badge settles with a small spring. `onDone` fires
 * once the animation has played, so the caller can reveal its CTA.
 */
export function SuccessTick({ color, onDone }: { color: string; onDone?: () => void }) {
  const ring = useSharedValue(0);
  const tick = useSharedValue(0);
  const pop = useSharedValue(0.8);

  useEffect(() => {
    ring.value = withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) });
    tick.value = withDelay(360, withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }));
    pop.value = withDelay(
      360,
      withSequence(
        withSpring(1.06, { damping: 6, stiffness: 180 }),
        withSpring(1, { damping: 12, stiffness: 160 }),
      ),
    );
    const t = setTimeout(() => onDone?.(), 900);
    return () => clearTimeout(t);
  }, [ring, tick, pop, onDone]);

  // Both strokes are drawn by animating dashoffset from "fully hidden" to 0.
  const ringProps = useAnimatedProps(() => ({
    strokeDashoffset: CIRC * (1 - ring.value),
  }));
  const tickProps = useAnimatedProps(() => ({
    strokeDashoffset: TICK_LEN * (1 - tick.value),
  }));
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  return (
    <Animated.View style={[styles.wrap, popStyle]}>
      <Svg width={SIZE} height={SIZE} viewBox="0 0 96 96">
        <AnimatedCircle
          cx="48"
          cy="48"
          r={R}
          stroke={color}
          strokeWidth={4}
          fill="none"
          strokeDasharray={CIRC}
          animatedProps={ringProps}
          strokeLinecap="round"
          // Start the ring at 12 o'clock rather than 3.
          transform="rotate(-90 48 48)"
        />
        <AnimatedPath
          d={TICK}
          stroke={color}
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={TICK_LEN}
          animatedProps={tickProps}
        />
      </Svg>
      <View />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
});
