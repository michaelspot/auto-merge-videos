import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii } from '../theme';
import type { AppTab } from '../types';

const tabs: Array<{
  key: AppTab;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
}> = [
  { key: 'montage', label: 'Montage', icon: 'film-outline', activeIcon: 'film' },
  { key: 'import', label: 'Importer', icon: 'cloud-upload-outline', activeIcon: 'cloud-upload' },
  { key: 'scrap', label: 'Scrap', icon: 'download-outline', activeIcon: 'download' },
  { key: 'higgsfield', label: 'Higgsfield', icon: 'sparkles-outline', activeIcon: 'sparkles' },
  { key: 'settings', label: 'Réglages', icon: 'settings-outline', activeIcon: 'settings' },
];

interface TabBarProps {
  value: AppTab;
  onChange: (tab: AppTab) => void;
  disabled?: boolean;
}

const tabChangeAnimation = {
  duration: 220,
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
  },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
} as const;

export function TabBar({ value, onChange, disabled = false }: TabBarProps) {
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.container, disabled && styles.disabled]}
    >
      {tabs.map((tab) => {
        const active = value === tab.key;

        return (
          <Pressable
            accessibilityHint={active ? undefined : `Afficher l’onglet ${tab.label}`}
            accessibilityLabel={tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled }}
            disabled={disabled}
            hitSlop={4}
            key={tab.key}
            onPress={() => {
              LayoutAnimation.configureNext(tabChangeAnimation);
              void Haptics.selectionAsync().catch(() => undefined);
              onChange(tab.key);
            }}
            style={({ pressed }) => [
              styles.tab,
              active ? styles.activeTab : styles.inactiveTab,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              color={active ? colors.background : colors.textMuted}
              name={active ? tab.activeIcon : tab.icon}
              size={active ? 22 : 24}
            />
            {active ? (
              <Text numberOfLines={1} style={styles.activeLabel}>
                {tab.label}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: radii.pill,
    backgroundColor: 'rgba(35, 35, 37, 0.94)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.38,
    shadowRadius: 18,
    elevation: 12,
  },
  tab: {
    height: 52,
    flexBasis: 0,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  inactiveTab: {
    flexGrow: 1,
  },
  activeTab: {
    flexGrow: 2.7,
    paddingHorizontal: 8,
    backgroundColor: colors.text,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
    elevation: 3,
  },
  activeLabel: {
    marginLeft: 6,
    color: colors.background,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.35,
  },
  pressed: {
    opacity: 0.68,
    transform: [{ scale: 0.97 }],
  },
  disabled: {
    opacity: 0.5,
  },
});
