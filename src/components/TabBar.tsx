import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors, radii, spacing } from '../theme';
import type { AppTab } from '../types';

const tabs: Array<{ key: AppTab; label: string }> = [
  { key: 'montage', label: 'Montage' },
  { key: 'import', label: 'Importer' },
  { key: 'bulk', label: 'Bulk' },
];

interface TabBarProps {
  value: AppTab;
  onChange: (tab: AppTab) => void;
  disabled?: boolean;
}

export function TabBar({ value, onChange, disabled }: TabBarProps) {
  return (
    <View accessibilityRole="tablist" style={styles.container}>
      {tabs.map((tab) => {
        const active = value === tab.key;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled }}
            disabled={disabled}
            key={tab.key}
            onPress={() => {
              void Haptics.selectionAsync();
              onChange(tab.key);
            }}
            style={({ pressed }) => [styles.tab, active && styles.active, pressed && styles.pressed]}
          >
            <Text style={[styles.label, active && styles.activeLabel]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 3,
    padding: 4,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tab: {
    flex: 1,
    minHeight: 39,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  active: {
    backgroundColor: colors.text,
  },
  label: {
    color: colors.textFaint,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  activeLabel: {
    color: colors.background,
  },
  pressed: {
    opacity: 0.75,
  },
});
