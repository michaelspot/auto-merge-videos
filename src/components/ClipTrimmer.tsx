import { memo, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import type { VideoThumbnail } from 'expo-video';

import { clipTime, MIN_CLIP_DURATION, moveClipBoundary, moveClipSelection, type ClipEditTarget } from '../clipTiming';
import { colors, spacing } from '../theme';
import type { ClipTrim } from '../types';

interface ClipTrimmerProps {
  duration: number;
  range: ClipTrim;
  position: Animated.Value;
  thumbnails: VideoThumbnail[];
  disabled: boolean;
  onChange: (range: ClipTrim) => void;
  onCommit: () => void;
  onEditingChange: (target: ClipEditTarget | null) => void;
}

interface TrimControlProps extends Omit<ClipTrimmerProps, 'position' | 'thumbnails'> {
  target: ClipEditTarget;
  width: number;
}

const HANDLE_WIDTH = 24;
export const CLIP_TRIMMER_HEIGHT = 108;

function TrimControl(props: TrimControlProps) {
  const latest = useRef(props);
  latest.current = props;
  const initialRange = useRef(props.range);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled && latest.current.width > 0,
    onMoveShouldSetPanResponder: () => !latest.current.disabled && latest.current.width > 0,
    onPanResponderGrant: () => {
      const current = latest.current;
      initialRange.current = current.range;
      current.onEditingChange(current.target);
    },
    onPanResponderMove: (_event, gesture) => {
      const current = latest.current;
      const offset = gesture.dx / current.width * current.duration;
      current.onChange(current.target === 'selection'
        ? moveClipSelection(initialRange.current, offset, current.duration)
        : moveClipBoundary(current.range, current.target, initialRange.current[current.target] + offset, current.duration));
    },
    onPanResponderRelease: () => {
      latest.current.onCommit();
      latest.current.onEditingChange(null);
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: () => {
      latest.current.onCommit();
      latest.current.onEditingChange(null);
    },
  }), []);
  const { target, range, duration, width, disabled } = props;
  const selection = target === 'selection';
  const start = target === 'start';
  const boundary = target === 'end' ? 'end' : 'start';
  const minimum = Math.min(MIN_CLIP_DURATION, duration);

  return (
    <View
      {...responder.panHandlers}
      accessible
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      accessibilityHint={selection ? 'Déplace les deux limites ensemble, sans changer la durée.' : 'Ajuste la limite de l’extrait par dixième de seconde.'}
      accessibilityLabel={selection ? 'Déplacer la sélection' : start ? 'Début de l’extrait' : 'Fin de l’extrait'}
      accessibilityRole="adjustable"
      accessibilityState={{ disabled }}
      accessibilityValue={{
        min: selection || start ? 0 : range.start + minimum,
        max: selection ? Math.max(0, duration - (range.end - range.start)) : start ? Math.max(0, range.end - minimum) : duration,
        now: range[boundary],
        text: selection ? `De ${clipTime(range.start)} à ${clipTime(range.end)}` : clipTime(range[boundary]),
      }}
      hitSlop={{ top: 8, bottom: 8 }}
      onAccessibilityAction={({ nativeEvent }) => {
        if (disabled || !['increment', 'decrement'].includes(nativeEvent.actionName)) return;
        props.onEditingChange(target);
        const offset = nativeEvent.actionName === 'increment' ? 0.1 : -0.1;
        props.onChange(selection
          ? moveClipSelection(range, offset, duration)
          : moveClipBoundary(range, boundary, range[boundary] + offset, duration));
        props.onCommit();
        props.onEditingChange(null);
      }}
      style={selection ? [styles.selection, {
          left: HANDLE_WIDTH + (duration > 0 ? range.start / duration * width : 0),
          width: duration > 0 ? (range.end - range.start) / duration * width : width,
        }] : [
          styles.handle,
          start ? styles.startHandle : styles.endHandle,
          { left: HANDLE_WIDTH + (duration > 0 ? range[boundary] / duration * width : 0) - (start ? HANDLE_WIDTH : 0) },
        ]}
    >
      {!selection ? <Ionicons accessible={false} color={colors.accentInk} name={start ? 'chevron-back' : 'chevron-forward'} size={22} /> : null}
    </View>
  );
}

export const ClipTrimmer = memo(function ClipTrimmer(props: ClipTrimmerProps) {
  const [width, setWidth] = useState(0);
  const { duration, range, thumbnails, position, disabled } = props;
  const startX = duration > 0 ? range.start / duration * width : 0;
  const endX = duration > 0 ? range.end / duration * width : width;

  return (
    <View style={[styles.container, disabled && styles.disabled]}>
      <View style={styles.labels}>
        <Text style={styles.time}>Début {clipTime(range.start)}</Text>
        <Text style={styles.time}>Fin {clipTime(range.end)}</Text>
      </View>
      <View style={styles.timeline}>
        <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={styles.track}>
          <View pointerEvents="none" style={styles.filmstrip}>
            {thumbnails.length > 0 ? thumbnails.map((thumbnail, index) => (
              <Image contentFit="cover" key={index} source={thumbnail} style={styles.thumbnail} />
            )) : Array.from({ length: 8 }, (_, index) => <View key={index} style={styles.tick} />)}
          </View>
          <View pointerEvents="none" style={[styles.shade, { left: 0, width: startX }]} />
          <View pointerEvents="none" style={[styles.shade, { left: endX, right: 0 }]} />
          <Animated.View
            pointerEvents="none"
            style={[styles.playhead, { transform: [{ translateX: position.interpolate({
              inputRange: [0, duration || 1], outputRange: [0, width], extrapolate: 'clamp',
            }) }] }]}
          />
        </View>
        <TrimControl {...props} target="selection" width={width} />
        <TrimControl {...props} target="start" width={width} />
        <TrimControl {...props} target="end" width={width} />
      </View>
      <Text style={styles.caption}>
        {duration > 0 ? `${clipTime(range.end - range.start)} · Enregistrement automatique` : 'Chargement de la vidéo…'}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { height: CLIP_TRIMMER_HEIGHT, width: '100%', paddingTop: spacing.md, gap: spacing.sm },
  labels: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.xs },
  time: { color: colors.text, fontSize: 11, fontVariant: ['tabular-nums'] },
  timeline: { paddingHorizontal: HANDLE_WIDTH, height: 48 },
  track: { flex: 1 },
  filmstrip: { ...StyleSheet.absoluteFill, flexDirection: 'row', overflow: 'hidden', backgroundColor: colors.surfaceSoft },
  thumbnail: { flex: 1, height: '100%' },
  tick: { flex: 1, borderRightWidth: 1, borderColor: colors.borderStrong },
  shade: { position: 'absolute', top: 0, bottom: 0, backgroundColor: colors.overlay },
  selection: { position: 'absolute', top: 0, bottom: 0, borderTopWidth: 3, borderBottomWidth: 3, borderColor: colors.accentWarm },
  handle: { position: 'absolute', top: 0, bottom: 0, width: HANDLE_WIDTH, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentWarm },
  startHandle: { borderTopLeftRadius: 7, borderBottomLeftRadius: 7 },
  endHandle: { borderTopRightRadius: 7, borderBottomRightRadius: 7 },
  playhead: { position: 'absolute', top: 4, bottom: 4, left: -1, width: 2, borderRadius: 1, backgroundColor: colors.text },
  caption: { color: colors.textMuted, textAlign: 'center', fontSize: 10, fontVariant: ['tabular-nums'] },
  disabled: { opacity: 0.45 },
});
