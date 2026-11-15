import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  type ListRenderItem,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';

import { colors, radii, spacing } from '../theme';
import type { ClipTrim, MediaItem } from '../types';
import { mediaId } from '../utils';
import { EmptyState } from './Section';
import { VideoPreview } from './VideoPreview';
import { CLIP_TRIMMER_HEIGHT } from './ClipTrimmer';

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
  layout?: 'stacked' | 'side';
  refreshing?: boolean;
  onRefresh?: () => void;
  maxHeight?: number;
  onTrimChange?: (item: MediaItem, trim: ClipTrim | null) => void;
}

const SIDE_RAIL_WIDTH = 64;
const SIDE_THUMB_HEIGHT = Math.round((SIDE_RAIL_WIDTH * 16) / 9);
const SIDE_THUMB_PITCH = SIDE_THUMB_HEIGHT + spacing.sm;

const THUMB_WIDTH = 62;
const HORIZONTAL_THUMB_PITCH = THUMB_WIDTH + spacing.sm;

function HorizontalThumbSeparator() {
  return <View style={styles.horizontalThumbSeparator} />;
}

function VerticalThumbSeparator() {
  return <View style={styles.verticalThumbSeparator} />;
}

function getSideItemLayout(_data: ArrayLike<MediaItem> | null | undefined, index: number) {
  return { length: SIDE_THUMB_PITCH, offset: SIDE_THUMB_PITCH * index, index };
}

function getHorizontalItemLayout(_data: ArrayLike<MediaItem> | null | undefined, index: number) {
  return { length: HORIZONTAL_THUMB_PITCH, offset: HORIZONTAL_THUMB_PITCH * index, index };
}

interface ThumbProps {
  item: MediaItem;
  index: number;
  previewed: boolean;
  selected: boolean;
  selectable: boolean;
  side: boolean;
  disabled: boolean;
  onPress: (index: number, id: string) => void;
}

// Memoized so that changing the preview only re-renders the two affected thumbnails.
const Thumb = memo(function Thumb({
  item,
  index,
  previewed,
  selected,
  selectable,
  side,
  disabled,
  onPress,
}: ThumbProps) {
  return (
    <Pressable
      accessibilityLabel={`${item.name}${previewed ? ', aperçu actuel' : ''}${selected ? ', sélectionné' : ''}`}
      accessibilityRole="button"
      accessibilityState={{ selected: selectable ? selected : previewed, disabled }}
      disabled={disabled}
      onPress={() => onPress(index, mediaId(item))}
      style={({ pressed }) => [
        styles.thumb,
        side && styles.sideThumb,
        previewed && styles.previewedThumb,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {item.posterUrl ? (
        <Image
          cachePolicy="memory-disk"
          contentFit="cover"
          recyclingKey={item.public_id}
          source={item.posterUrl}
          style={styles.image}
        />
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
});

export const MediaSelector = memo(function MediaSelector({
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
  layout = 'stacked',
  refreshing = false,
  onRefresh,
  maxHeight,
  onTrimChange,
}: MediaSelectorProps) {
  const window = useWindowDimensions();
  const [trimming, setTrimming] = useState(false);
  const safeIndex = Math.min(Math.max(currentIndex, 0), Math.max(items.length - 1, 0));
  const current = items[safeIndex];
  const side = layout === 'side';
  const availableWidth = window.width - spacing.lg * 2;
  const sidePreviewHeight = Math.min(
    (availableWidth - SIDE_RAIL_WIDTH - spacing.md) * (16 / 9) + (onTrimChange ? CLIP_TRIMMER_HEIGHT : 0),
    window.height * (onTrimChange ? 0.72 : 0.6),
    maxHeight ?? Number.POSITIVE_INFINITY,
  );
  const handleTrimChange = useCallback((trim: ClipTrim | null) => {
    if (current) onTrimChange?.(current, trim);
  }, [current, onTrimChange]);

  useEffect(() => {
    if (items.length > 0 && currentIndex !== safeIndex) onChangeIndex(safeIndex);
  }, [currentIndex, items.length, onChangeIndex, safeIndex]);

  const handleThumbPress = useCallback((index: number, id: string) => {
    void Haptics.selectionAsync();
    onChangeIndex(index);
    onToggleSelection?.(id);
  }, [onChangeIndex, onToggleSelection]);

  const extraData = useMemo(
    () => ({ safeIndex, selectedIds, disabled, side, handleThumbPress }),
    [disabled, handleThumbPress, safeIndex, selectedIds, side],
  );

  const renderThumb = useCallback<ListRenderItem<MediaItem>>(({ item, index }) => (
    <Thumb
      disabled={disabled}
      index={index}
      item={item}
      onPress={handleThumbPress}
      previewed={index === safeIndex}
      selectable={!!onToggleSelection}
      selected={selectedIds?.has(mediaId(item)) ?? false}
      side={side}
    />
  ), [disabled, handleThumbPress, onToggleSelection, safeIndex, selectedIds, side]);

  if (!current) {
    const emptyState = <EmptyState label={emptyLabel} />;
    if (!side || !onRefresh) return emptyState;

    return (
      <ScrollView
        alwaysBounceVertical
        contentContainerStyle={styles.emptyRefreshContent}
        refreshControl={
          <RefreshControl
            enabled={!disabled}
            onRefresh={onRefresh}
            refreshing={refreshing}
            tintColor={colors.accent}
          />
        }
        showsVerticalScrollIndicator={false}
        style={styles.emptyRefreshScroller}
      >
        {emptyState}
      </ScrollView>
    );
  }

  const thumbnails = (
    <FlatList
      alwaysBounceVertical={side}
      contentContainerStyle={[styles.thumbsContent, side && styles.sideThumbsContent]}
      data={items}
      extraData={extraData}
      getItemLayout={side ? getSideItemLayout : getHorizontalItemLayout}
      horizontal={!side}
      initialNumToRender={side ? 5 : 4}
      ItemSeparatorComponent={side ? VerticalThumbSeparator : HorizontalThumbSeparator}
      keyExtractor={mediaId}
      maxToRenderPerBatch={8}
      refreshControl={
        side && onRefresh ? (
          <RefreshControl
            enabled={!disabled}
            onRefresh={onRefresh}
            refreshing={refreshing}
            tintColor={colors.accent}
          />
        ) : undefined
      }
      renderItem={renderThumb}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      style={[styles.thumbs, side && styles.sideThumbs]}
      windowSize={5}
    />
  );

  const previewContent = (
    <View style={[styles.previewColumn, side && styles.sidePreviewColumn]}>
      <View style={[styles.previewFrame, side && styles.sidePreviewFrame]}>
        <VideoPreview
          active={active}
          disabled={disabled}
          key={`${current.public_id}:${current.lastModified}`}
          naturalSize={side}
          onEditingChange={setTrimming}
          onTrimChange={onTrimChange ? handleTrimChange : undefined}
          posterUrl={current.posterUrl}
          trim={current.trim}
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
      {!side ? (
        <>
          <Text numberOfLines={1} style={styles.name}>
            {current.name}
          </Text>
          <Text style={styles.count}>
            {safeIndex + 1} / {items.length}
          </Text>
        </>
      ) : null}
    </View>
  );

  const preview =
    side && onRefresh ? (
      <ScrollView
        alwaysBounceVertical
        contentContainerStyle={[styles.sidePreviewRefreshContent, { height: sidePreviewHeight }]}
        refreshControl={
          <RefreshControl
            enabled={!disabled && !trimming}
            onRefresh={onRefresh}
            refreshing={refreshing}
            tintColor={colors.accent}
          />
        }
        scrollEnabled={!trimming}
        showsVerticalScrollIndicator={false}
        style={styles.sidePreviewScroller}
      >
        {previewContent}
      </ScrollView>
    ) : (
      previewContent
    );

  return (
    <View
      style={[
        styles.row,
        compact && styles.compactRow,
        side && styles.sideRow,
        side && { height: sidePreviewHeight },
      ]}
    >
      {side ? preview : thumbnails}
      {side ? thumbnails : preview}
    </View>
  );
});

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
  horizontalThumbSeparator: {
    width: spacing.sm,
  },
  verticalThumbSeparator: {
    height: spacing.sm,
  },
  thumb: {
    width: THUMB_WIDTH,
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
  sideRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.md,
  },
  sideThumbs: {
    width: SIDE_RAIL_WIDTH,
    height: '100%',
  },
  sideThumbsContent: {
    alignItems: 'center',
    paddingRight: 0,
    paddingBottom: spacing.sm,
  },
  sideThumb: {
    width: SIDE_RAIL_WIDTH,
    height: SIDE_THUMB_HEIGHT,
  },
  sidePreviewColumn: {
    minWidth: 0,
    justifyContent: 'center',
  },
  sidePreviewFrame: {
    height: '100%',
    width: '100%',
    aspectRatio: undefined,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
  },
  sidePreviewScroller: {
    flex: 1,
  },
  sidePreviewRefreshContent: {
    alignItems: 'stretch',
  },
  emptyRefreshScroller: {
    flex: 1,
    width: '100%',
  },
  emptyRefreshContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.42,
  },
});
