import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors, radii, spacing } from '../theme';

interface TagChipsProps {
  tags: string[];
  selected: Set<string>;
  onToggle: (tag: string) => void;
  emptyLabel?: string;
  disabled?: boolean;
}

export function TagChips({ tags, selected, onToggle, emptyLabel, disabled = false }: TagChipsProps) {
  if (tags.length === 0) {
    return emptyLabel ? <Text style={styles.emptyLabel}>{emptyLabel}</Text> : null;
  }

  return (
    <ScrollView
      contentContainerStyle={styles.row}
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
    >
      {tags.map((tag) => {
        const active = selected.has(tag);
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled }}
            disabled={disabled}
            key={tag}
            onPress={() => {
              void Haptics.selectionAsync();
              onToggle(tag);
            }}
            style={({ pressed }) => [
              styles.chip,
              active && styles.activeChip,
              disabled && styles.disabled,
              pressed && !disabled && styles.pressed,
            ]}
          >
            <Text numberOfLines={1} style={[styles.label, active && styles.activeLabel]}>
              {tag}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function TagFilterPanel(props: TagChipsProps) {
  return (
    <View style={styles.filterPanel}>
      <TagChips {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 7,
    paddingRight: spacing.lg,
  },
  chip: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
  },
  activeChip: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  label: {
    maxWidth: 180,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  activeLabel: {
    color: colors.accentInk,
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.42,
  },
  filterPanel: {
    marginTop: -4,
    marginBottom: spacing.md,
  },
  emptyLabel: {
    color: colors.textFaint,
    fontSize: 12,
  },
});
