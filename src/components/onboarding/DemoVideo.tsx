import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet } from 'react-native';

import { DEMO_VIDEO } from './demoAsset';

/** The demo clip. Autoplays, muted, and loops if the conversion outlasts it. */
export function DemoVideo({ height }: { height: number }) {
  const player = useVideoPlayer(DEMO_VIDEO, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  return (
    <VideoView
      style={[styles.media, { height }]}
      player={player}
      nativeControls={false}
      contentFit="contain"
    />
  );
}

const styles = StyleSheet.create({
  media: { width: '100%', borderRadius: 20, overflow: 'hidden' },
});
