import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Haptics from 'expo-haptics';

import { colors, radii, spacing } from '../theme';
import type { MediaItem } from '../types';
import { mediaId } from '../utils';
import { EmptyState } from './Section';

interface MusicSelectorProps {
  items: MediaItem[];
  selectedIds: Set<string>;
  onToggleSelection: (id: string) => void;
  active: boolean;
  disabled?: boolean;
}

export function MusicSelector({
  items,
  selectedIds,
  onToggleSelection,
  active,
  disabled = false,
}: MusicSelectorProps) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      player.pause();
      setPlayingId(null);
    }
  }, [active, player]);

  useEffect(() => {
    if (playingId && status.didJustFinish) setPlayingId(null);
  }, [playingId, status.didJustFinish]);

  if (items.length === 0) return <EmptyState label="Aucune musique importée." />;

  const togglePlayback = (item: MediaItem) => {
    if (disabled) return;
    const id = mediaId(item);
    void Haptics.selectionAsync();
    if (playingId === id && status.playing) {
      player.pause();
      setPlayingId(null);
      return;
    }
    player.pause();
    player.replace(item.url);
    player.play();
    setPlayingId(id);
  };

  return (
    <FlatList
      contentContainerStyle={styles.row}
      data={items}
      extraData={{ playingId, selectedIds, statusPlaying: status.playing }}
      horizontal
      initialNumToRender={5}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      keyExtractor={mediaId}
      maxToRenderPerBatch={8}
      renderItem={({ item }) => {
        const id = mediaId(item);
        const selected = selectedIds.has(id);
        const playing = playingId === id && status.playing;
        return (
          <Pressable
            accessibilityLabel={`${item.name}${selected ? ', sélectionnée' : ''}`}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onToggleSelection(id)}
            style={({ pressed }) => [
              styles.card,
              selected && styles.selectedCard,
              disabled && styles.disabled,
              pressed && !disabled && styles.pressed,
            ]}
          >
            <Pressable
              accessibilityLabel={playing ? `Mettre ${item.name} en pause` : `Écouter ${item.name}`}
              accessibilityRole="button"
              accessibilityState={{ disabled }}
              disabled={disabled}
              hitSlop={10}
              onPress={() => togglePlayback(item)}
              style={styles.play}
            >
              <Ionicons color={colors.text} name={playing ? 'pause' : 'play'} size={18} />
            </Pressable>
            <Text numberOfLines={2} style={styles.name}>
              {item.name}
            </Text>
            {selected ? (
              <View style={styles.check}>
                <Ionicons color={colors.accentInk} name="checkmark" size={11} />
              </View>
            ) : null}
          </Pressable>
        );
      }}
      showsHorizontalScrollIndicator={false}
      windowSize={5}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    paddingRight: spacing.lg,
  },
  separator: {
    width: spacing.sm,
  },
  card: {
    width: 104,
    height: 104,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.sm,
  },
  selectedCard: {
    borderColor: colors.accent,
  },
  play: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    backgroundColor: colors.surfaceSoft,
  },
  name: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 13,
    textAlign: 'center',
  },
  check: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: colors.accent,
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.42,
  },
});
