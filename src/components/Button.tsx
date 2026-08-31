import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';

import { colors, radii, spacing } from '../theme';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: ComponentProps<typeof Ionicons>['name'];
  compact?: boolean;
}

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  icon,
  compact = false,
}: PrimaryButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        styles.primary,
        compact && styles.compact,
        (disabled || loading) && styles.disabled,
        pressed && !(disabled || loading) && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.accentInk} />
      ) : (
        <View style={styles.content}>
          {icon ? <Ionicons color={colors.accentInk} name={icon} size={19} /> : null}
          <Text style={styles.primaryLabel}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

interface IconButtonProps {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  danger?: boolean;
  active?: boolean;
  disabled?: boolean;
}

export function IconButton({ icon, label, onPress, danger, active, disabled }: IconButtonProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(active) }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        active && styles.iconButtonActive,
        danger && styles.iconButtonDanger,
        disabled && styles.disabled,
        pressed && !disabled && styles.iconPressed,
      ]}
    >
      <Ionicons
        color={danger ? colors.danger : active ? colors.accentInk : colors.textMuted}
        name={icon}
        size={17}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.xl,
  },
  compact: {
    minHeight: 46,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  disabled: {
    opacity: 0.38,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  primaryLabel: {
    color: colors.accentInk,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  iconButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  iconButtonDanger: {
    backgroundColor: colors.dangerSoft,
    borderColor: '#4B2427',
  },
  iconPressed: {
    opacity: 0.7,
  },
});
