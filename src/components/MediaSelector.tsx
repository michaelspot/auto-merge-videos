import { useEffect } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';

import { colors, radii, spacing } from '../theme';
import type { MediaItem } from '../types';
import { mediaId } from '../utils';
import { EmptyState } from './Section';
import { VideoPreview } from './VideoPreview';

interface MediaSelectorProps {
  items: MediaItem[];
  currentIndex: number;
  onChangeIndex: (index: number) => void;
  active: boolean;
  onDelete?: (item: MediaItem) => void;
  selectedIds?: Set<string>;
  onToggleSelection?: (id: string) => void;
  emptyLabel: string;
  compact?: boolean;
  disabled?: boolean;
}

export function MediaSelector({
  items,
  currentIndex,
  onChangeIndex,
  active,
  onDelete,
  selectedIds,
  onToggleSelection,
  emptyLabel,
  compact = false,
  disabled = false,
}: MediaSelectorProps) {
  const safeIndex = Math.min(Math.max(currentIndex, 0), Math.max(items.length - 1, 0));
  const current = items[safeIndex];

  useEffect(() => {
    if (items.length > 0 && currentIndex !== safeIndex) onChangeIndex(safeIndex);
  }, [currentIndex, items.length, onChangeIndex, safeIndex]);

  if (!current) return <EmptyState label={emptyLabel} />;

  return (
    <View>
      <View style={[styles.row, compact && styles.compactRow]}>
        <FlatList
          contentContainerStyle={styles.thumbsContent}
          data={items}
          extraData={{ currentIndex: safeIndex, selectedIds }}
          horizontal
          initialNumToRender={4}
          ItemSeparatorComponent={() => <View style={styles.thumbSeparator} />}
          keyExtractor={mediaId}
          maxToRenderPerBatch={6}
          renderItem={({ item, index }) => {
            const selected = selectedIds?.has(mediaId(item)) ?? false;
            const previewed = index === safeIndex;
            return (
              <Pressable
                accessibilityLabel={`${item.name}${selected ? ', sélectionné' : ''}`}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                onPress={() => {
                  void Haptics.selectionAsync();
                  onChangeIndex(index);
                  if (onToggleSelection) onToggleSelection(mediaId(item));
                }}
                style={({ pressed }) => [
                  styles.thumb,
                  previewed && styles.previewedThumb,
                  disabled && styles.disabled,
                  pressed && !disabled && styles.pressed,
                ]}
              >
                {item.posterUrl ? (
                  <Image contentFit="cover" recyclingKey={item.public_id} source={item.posterUrl} style={styles.image} />
                ) : (
                  <View style={[styles.image, styles.imageFallback]}>
                    <Ionicons color={colors.textFaint} name="videocam" size={18} />
                  </View>
                )}
                {selected ? (
                  <View style={styles.check}>
                    <Ionicons color={colors.accentInk} name="checkmark" size={11} />
                  </View>
                ) : null}
              </Pressable>
            );
          }}
          showsHorizontalScrollIndicator={false}
          style={styles.thumbs}
          windowSize={5}
        />

        <View style={styles.previewColumn}>
          <View style={styles.previewFrame}>
            <VideoPreview
              active={active}
              posterUrl={current.posterUrl}
              url={current.url}
            />
            {onDelete ? (
              <Pressable
                accessibilityLabel={`Supprimer ${current.name}`}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                disabled={disabled}
                hitSlop={8}
                onPress={() => onDelete(current)}
                style={({ pressed }) => [
                  styles.deleteButton,
                  disabled && styles.disabled,
                  pressed && !disabled && styles.pressed,
                ]}
              >
                <Ionicons color={colors.danger} name="trash-outline" size={17} />
              </Pressable>
            ) : null}
          </View>
          <Text numberOfLines={1} style={styles.name}>
            {current.name}
          </Text>
          <Text style={styles.count}>
            {safeIndex + 1} / {items.length}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    height: 458,
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacing.md,
  },
  compactRow: {
    height: 430,
  },
  thumbs: {
    width: '100%',
    height: 110,
    flexGrow: 0,
  },
  thumbsContent: {
    paddingRight: spacing.sm,
  },
  thumbSeparator: {
    width: spacing.sm,
  },
  thumb: {
    width: 62,
    height: 110,
    overflow: 'hidden',
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
  },
  previewedThumb: {
    borderColor: colors.text,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imageFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: colors.accent,
  },
  previewColumn: {
    flex: 1,
    alignItems: 'center',
  },
  previewFrame: {
    height: '89%',
    aspectRatio: 9 / 16,
    overflow: 'hidden',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  deleteButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#492426',
    borderRadius: radii.sm,
    backgroundColor: colors.overlay,
  },
  name: {
    maxWidth: '90%',
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 8,
  },
  count: {
    color: colors.textFaint,
    fontSize: 10,
    marginTop: 2,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.42,
  },
});
