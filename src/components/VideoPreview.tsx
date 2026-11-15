import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, StyleSheet, Text, View } from 'react-native';
import { VideoView, useVideoPlayer, type VideoThumbnail } from 'expo-video';
import { Image } from 'expo-image';

import { clipCutPreviewTime, clipRange, type ClipEditTarget } from '../clipTiming';
import { colors } from '../theme';
import type { ClipTrim } from '../types';
import { CLIP_TRIMMER_HEIGHT, ClipTrimmer } from './ClipTrimmer';

interface VideoPreviewProps {
  url: string;
  posterUrl?: string;
  active: boolean;
  controls?: boolean;
  trim?: ClipTrim;
  naturalSize?: boolean;
  disabled?: boolean;
  onTrimChange?: (trim: ClipTrim | null) => void;
  onEditingChange?: (editing: boolean) => void;
}

export function VideoPreview(props: VideoPreviewProps) {
  if (!props.active) {
    return (
      <View style={styles.container}>
        {props.posterUrl ? <Image cachePolicy="memory-disk" contentFit="contain" source={props.posterUrl} style={StyleSheet.absoluteFill} /> : null}
      </View>
    );
  }

  return <VideoSurface {...props} key={`${props.url}:${props.controls ? 'controls' : 'preview'}`} />;
}

function VideoSurface({
  url, posterUrl, controls = false, trim, naturalSize = false, disabled = false,
  onTrimChange, onEditingChange,
}: VideoPreviewProps) {
  const editable = !!onTrimChange;
  const [duration, setDuration] = useState(0);
  const [aspectRatio, setAspectRatio] = useState(9 / 16);
  const sourceRatio = useRef<number | null>(null);
  const displayRatio = useRef<number | null>(null);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState(trim);
  const [thumbnails, setThumbnails] = useState<VideoThumbnail[]>([]);
  const [error, setError] = useState(false);
  const editTarget = useRef<ClipEditTarget | null>(null);
  const frameRate = useRef(30);
  const position = useRef(new Animated.Value(0)).current;
  const range = useMemo(() => clipRange(draft, duration), [draft, duration]);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const trimRef = useRef(trim);
  trimRef.current = trim;
  // Time events cross the bridge 20×/s: only emit them when a trimmer playhead or a
  // trimmed loop needs them (native looping covers the untrimmed preview).
  const needsTimeUpdates = !controls && (editable || !!trim);
  const player = useVideoPlayer(url, (instance) => {
    instance.loop = !controls;
    instance.muted = !controls;
    instance.audioMixingMode = 'mixWithOthers';
    instance.timeUpdateEventInterval = needsTimeUpdates ? 0.05 : 0;
    instance.seekTolerance = { toleranceBefore: 0, toleranceAfter: 0 };
  });

  useEffect(() => setDraft(trim), [trim]);

  useEffect(() => {
    player.timeUpdateEventInterval = needsTimeUpdates ? 0.05 : 0;
  }, [needsTimeUpdates, player]);

  useEffect(() => {
    const updateMetadata = (length: number, size?: { width: number; height: number }, fps?: number | null) => {
      if (Number.isFinite(length) && length > 0) setDuration(length);
      if (fps && Number.isFinite(fps) && fps > 0) frameRate.current = fps;
      if (size && size.width > 0 && size.height > 0) {
        sourceRatio.current = size.width / size.height;
        if (!displayRatio.current) setAspectRatio(sourceRatio.current);
      }
    };
    const loaded = player.addListener('sourceLoad', (event) => {
      const track = event.availableVideoTracks[0];
      updateMetadata(event.duration, track?.size, track?.frameRate);
      if (!controls) {
        const selected = clipRange(trimRef.current, event.duration);
        rangeRef.current = selected;
        player.currentTime = selected.start;
      }
    });
    const track = player.addListener('videoTrackChange', (event) => {
      updateMetadata(player.duration, event.videoTrack?.size, event.videoTrack?.frameRate);
    });
    const status = player.addListener('statusChange', (event) => setError(event.status === 'error'));
    const videoTrack = player.videoTrack ?? player.availableVideoTracks[0];
    updateMetadata(player.duration, videoTrack?.size, videoTrack?.frameRate);
    if (!controls && editTarget.current === null) player.play();
    return () => { loaded.remove(); track.remove(); status.remove(); };
  }, [controls, player]);

  useEffect(() => {
    if ((!editable && !naturalSize) || duration <= 0) return;
    let cancelled = false;
    const times = editable ? Array.from({ length: 8 }, (_, index) => (duration * index) / 8) : [0];
    void player.generateThumbnailsAsync(times, { maxWidth: 100, maxHeight: 96 })
      .then((images) => {
        if (cancelled) return;
        setThumbnails(images);
        // Thumbnails include the source's display rotation (track dimensions on iOS do not).
        const first = images[0];
        if (first && first.width > 0 && first.height > 0) {
          const thumbnailRatio = first.width / first.height;
          const originalRatio = sourceRatio.current ?? thumbnailRatio;
          displayRatio.current = (originalRatio < 1) !== (thumbnailRatio < 1) ? 1 / originalRatio : originalRatio;
          setAspectRatio(displayRatio.current);
        }
      })
      .catch(() => { /* The handles remain usable if the source cannot provide thumbnails. */ });
    return () => { cancelled = true; };
  }, [duration, editable, naturalSize, player]);

  useEffect(() => {
    if (controls || duration <= 0 || editTarget.current !== null) return;
    player.loop = range.start === 0 && range.end >= duration;
    if (player.currentTime < range.start || player.currentTime >= range.end) {
      player.currentTime = range.start;
      position.setValue(range.start);
    }
    player.play();
  }, [controls, duration, player, position, range.end, range.start]);

  useEffect(() => {
    if (controls) return;
    let lastSeek = 0;
    const repeat = () => {
      if (editTarget.current !== null || rangeRef.current.end <= 0) return;
      player.currentTime = rangeRef.current.start;
      position.setValue(rangeRef.current.start);
      player.play();
      lastSeek = Date.now();
    };
    const time = player.addListener('timeUpdate', ({ currentTime }) => {
      if (editTarget.current !== null) return;
      const selected = rangeRef.current;
      if (selected.end > 0 && (currentTime < selected.start || currentTime >= selected.end)) {
        if (Date.now() - lastSeek > 120) repeat();
      } else {
        position.setValue(currentTime);
      }
    });
    const ended = player.addListener('playToEnd', repeat);
    return () => { time.remove(); ended.remove(); };
  }, [controls, player, position]);

  const showCutFrame = useCallback((selected: ClipTrim, target: ClipEditTarget) => {
    const time = clipCutPreviewTime(selected, target, frameRate.current);
    player.pause();
    player.currentTime = time;
    position.setValue(time);
  }, [player, position]);

  const changeRange = useCallback((next: ClipTrim) => {
    rangeRef.current = next;
    setDraft(next);
    if (editTarget.current !== null) showCutFrame(next, editTarget.current);
  }, [showCutFrame]);

  const commitRange = useCallback(() => {
    const selected = rangeRef.current;
    if (selected.end <= 0 || !onTrimChange) return;
    try {
      onTrimChange(selected.start === 0 && selected.end >= duration ? null : selected);
    } catch {
      setDraft(trim);
      rangeRef.current = clipRange(trim, duration);
      Alert.alert('Sélection non enregistrée', 'Impossible de mémoriser cet extrait. Réessaie.');
    }
  }, [duration, onTrimChange, trim]);

  const editingChange = useCallback((target: ClipEditTarget | null) => {
    editTarget.current = target;
    player.scrubbingModeOptions = { scrubbingModeEnabled: target !== null };
    if (target !== null) {
      player.loop = false;
      showCutFrame(rangeRef.current, target);
    } else {
      const selected = rangeRef.current;
      player.loop = selected.start === 0 && selected.end >= duration;
      player.currentTime = selected.start;
      position.setValue(selected.start);
      player.play();
    }
    onEditingChange?.(target !== null);
  }, [duration, onEditingChange, player, position, showCutFrame]);

  const videoHeight = Math.max(0, layout.height - (editable ? CLIP_TRIMMER_HEIGHT : 0));
  const frameWidth = Math.min(layout.width, videoHeight * aspectRatio);

  return (
    <View
      onLayout={(event) => setLayout(event.nativeEvent.layout)}
      style={styles.container}
    >
      <View style={styles.videoArea}>
        <View style={naturalSize && frameWidth > 0
          ? { width: frameWidth, height: frameWidth / aspectRatio }
          : styles.fullFrame}>
          {posterUrl ? <Image cachePolicy="memory-disk" contentFit="contain" source={posterUrl} style={StyleSheet.absoluteFill} /> : null}
          <VideoView
            contentFit="contain"
            nativeControls={controls}
            player={player}
            style={StyleSheet.absoluteFill}
          />
          {error ? <View style={styles.error}><Text style={styles.errorText}>Vidéo indisponible</Text></View> : null}
        </View>
      </View>
      {editable ? (
        <ClipTrimmer
          disabled={disabled || duration <= 0 || error}
          duration={duration}
          onChange={changeRange}
          onCommit={commitRange}
          onEditingChange={editingChange}
          position={position}
          range={range}
          thumbnails={thumbnails}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', backgroundColor: 'transparent' },
  videoArea: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
  fullFrame: { width: '100%', height: '100%' },
  error: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay },
  errorText: { color: colors.textMuted, fontSize: 12 },
});
