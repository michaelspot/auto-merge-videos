import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Image } from 'expo-image';

import { colors } from '../theme';

interface VideoPreviewProps {
  url: string;
  posterUrl?: string;
  active: boolean;
  controls?: boolean;
}

export function VideoPreview({ url, posterUrl, active, controls = false }: VideoPreviewProps) {
  if (!active) {
    return (
      <View style={styles.container}>
        {posterUrl ? <Image contentFit="cover" source={posterUrl} style={StyleSheet.absoluteFill} /> : null}
      </View>
    );
  }

  return (
    <VideoSurface
      active
      controls={controls}
      key={`${url}:${controls ? 'controls' : 'preview'}`}
      posterUrl={posterUrl}
      url={url}
    />
  );
}

function VideoSurface({ url, posterUrl, active, controls }: VideoPreviewProps) {
  const player = useVideoPlayer(url, (instance) => {
    instance.loop = !controls;
    instance.muted = !controls;
    instance.audioMixingMode = 'mixWithOthers';
    if (active && !controls) instance.play();
  });

  useEffect(() => {
    if (active && !controls) player.play();
    else if (!active) player.pause();
  }, [active, controls, player]);

  return (
    <View style={styles.container}>
      {posterUrl ? <Image contentFit="cover" source={posterUrl} style={StyleSheet.absoluteFill} /> : null}
      <VideoView
        contentFit="contain"
        nativeControls={controls}
        player={player}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
});
