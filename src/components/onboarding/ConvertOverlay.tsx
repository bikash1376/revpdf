import { useEffect } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { Button, Text, useTheme } from 'react-native-paper';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from '@/theme/tokens';

import { DemoVideo } from './DemoVideo';
import { WaveProgress } from './WaveProgress';

const SCREEN_H = Dimensions.get('window').height;

// The clip is held back for a beat so the wave is the only thing on screen when
// the conversion starts, then flies up.
const VIDEO_DELAY = 3500;
const VIDEO_RISE = 900;
const VIDEO_FALL = 450;

type Props = {
  progress: number;
  /** Set once the EPUB is on disk — this is what arms the Open button. */
  documentId: string | null;
  onOpen: (documentId: string) => void;
};

/**
 * The conversion screen: a wave pinned to the top, and the demo clip rising from
 * the bottom to fill the wait. Open stays disabled until the conversion actually
 * finishes — the button's state is the real state, not a timer.
 */
export function ConvertOverlay({ progress, documentId, onOpen }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const videoH = Math.min(420, SCREEN_H * 0.46);
  // Start below the fold; slide to 0.
  const rise = useSharedValue(SCREEN_H);

  useEffect(() => {
    rise.value = withDelay(
      VIDEO_DELAY,
      withTiming(0, { duration: VIDEO_RISE, easing: Easing.out(Easing.cubic) }),
    );
  }, [rise]);

  const videoStyle = useAnimatedStyle(() => ({ transform: [{ translateY: rise.value }] }));

  const handleOpen = () => {
    if (!documentId) return;
    // Send the clip back down, then hand over to the reader.
    rise.value = withTiming(
      SCREEN_H,
      { duration: VIDEO_FALL, easing: Easing.in(Easing.cubic) },
      (done) => {
        if (done) runOnJS(onOpen)(documentId);
      },
    );
  };

  const ready = !!documentId;

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: theme.colors.background, paddingTop: insets.top + spacing.lg },
      ]}>
      <View style={styles.top}>
        <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
          Setting things up
        </Text>
        <View style={styles.wave}>
          <WaveProgress progress={progress} />
        </View>
      </View>

      <Animated.View style={[styles.videoWrap, videoStyle]}>
        <DemoVideo height={videoH} />
        <Button
          mode="contained"
          disabled={!ready}
          onPress={handleOpen}
          style={[styles.open, { marginBottom: insets.bottom + spacing.lg }]}
          contentStyle={styles.openContent}>
          Open
        </Button>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 10 },
  top: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  wave: { paddingTop: spacing.xs },
  videoWrap: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  open: { minWidth: 200, alignSelf: 'center' },
  openContent: { height: 48 },
});
