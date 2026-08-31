import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { colors, radii, spacing } from '../theme';
import type { TextItem } from '../types';
import { textId } from '../utils';
import { EmptyState } from './Section';

interface TextSelectorProps {
  items: TextItem[];
  allItems: TextItem[];
  selectedIds: Set<string>;
  onToggleSelection: (id: string) => void;
  disabled?: boolean;
}

export function TextSelector({
  items,
  allItems,
  selectedIds,
  onToggleSelection,
  disabled = false,
}: TextSelectorProps) {
  if (items.length === 0) return <EmptyState label="Aucun texte dans ce filtre." />;

  return (
    <FlatList
      contentContainerStyle={styles.row}
      data={items}
      extraData={selectedIds}
      horizontal
      initialNumToRender={3}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      keyExtractor={(item) => textId(item, Math.max(0, allItems.indexOf(item)))}
      maxToRenderPerBatch={5}
      renderItem={({ item }) => {
        const originalIndex = allItems.indexOf(item);
        const id = textId(item, Math.max(0, originalIndex));
        const selected = selectedIds.has(id);
        return (
          <Pressable
            accessibilityLabel={item.text}
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
            <Text numberOfLines={4} style={styles.text}>
              {item.text.replace(/\s{2,}/g, '\n').trim()}
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
      windowSize={4}
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
    width: 234,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  selectedCard: {
    borderColor: colors.accent,
  },
  text: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  check: {
    position: 'absolute',
    top: 7,
    right: 7,
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
