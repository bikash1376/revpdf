import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { DEMO_VIDEO } from './demoAsset';

/**
 * The looping demo clip shown while the conversion runs.
 *
 * Until a real `assets/onboarding/demo.mp4` is dropped in, `DEMO_VIDEO` is null
 * and we render a placeholder rather than a broken player — the app ships with
 * no network access, so there is nothing to stream in its place.
 */
export function DemoVideo({ height }: { height: number }) {
  if (!DEMO_VIDEO) return <DemoPlaceholder height={height} />;
  return <DemoPlayer height={height} />;
}

/** Real player. Only mounted when the asset exists, so expo-video stays lazy. */
function DemoPlayer({ height }: { height: number }) {
  // Required lazily: importing expo-video at module scope would pull the native
  // module into every build, including ones without the asset.
  const { useVideoPlayer, VideoView } = require('expo-video');
  const player = useVideoPlayer(DEMO_VIDEO, (p: any) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  return (
    <VideoView
      style={[styles.media, { height }]}
      player={player}
      nativeControls={false}
      contentFit="cover"
    />
  );
}

/** Placeholder: a slow shimmer over the app's own colors, plus an honest label. */
function DemoPlaceholder({ height }: { height: number }) {
  const theme = useTheme();
  const shimmer = useSharedValue(0);

  useEffect(() => {
    shimmer.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [shimmer]);

  const style = useAnimatedStyle(() => ({ opacity: 0.35 + shimmer.value * 0.35 }));

  return (
    <View
      style={[
        styles.media,
        styles.placeholder,
        { height, backgroundColor: theme.colors.surfaceVariant },
      ]}>
      <Animated.View
        style={[styles.shimmer, style, { backgroundColor: theme.colors.primaryContainer }]}
      />
      <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>
        Demo video
      </Text>
      <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, opacity: 0.7 }}>
        drop assets/onboarding/demo.mp4
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  media: { width: '100%', borderRadius: 20, overflow: 'hidden' },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  shimmer: { ...StyleSheet.absoluteFillObject },
});
