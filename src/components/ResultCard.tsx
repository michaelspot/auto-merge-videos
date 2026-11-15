import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';

import { saveVideoToPhotos } from '../files';
import { colors, radii, spacing } from '../theme';
import type { GeneratedVideo } from '../types';
import { errorMessage } from '../utils';
import { VideoPreview } from './VideoPreview';

interface ResultCardProps {
  result: GeneratedVideo;
  active: boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

export function ResultCard({ result, active, disabled = false, onBusyChange }: ResultCardProps) {
  const window = useWindowDimensions();
  const [saving, setSaving] = useState(false);
  const previewHeight = Math.min((window.width - spacing.lg * 2) * (16 / 9), window.height * 0.54);

  const handleSave = async () => {
    if (disabled || saving) return;
    setSaving(true);
    onBusyChange?.(true);
    try {
      await saveVideoToPhotos(result.url, result.name);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Vidéo sauvegardée', 'La vidéo est maintenant dans ta photothèque.');
    } catch (error) {
      Alert.alert('Sauvegarde impossible', errorMessage(error));
    } finally {
      setSaving(false);
      onBusyChange?.(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.badge}>
          <Ionicons color={colors.success} name="checkmark-circle" size={17} />
          <Text style={styles.badgeText}>Vidéo prête</Text>
        </View>
      </View>
      <View style={styles.previewShell}>
        <View style={[styles.preview, { height: previewHeight }]}>
          <VideoPreview active={active} controls url={result.url} />
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel="Sauvegarder la vidéo dans Photos"
          accessibilityRole="button"
          accessibilityState={{ disabled: disabled || saving, busy: saving }}
          disabled={disabled || saving}
          onPress={() => void handleSave()}
          style={({ pressed }) => [
            styles.action,
            styles.primaryAction,
            (disabled || saving) && styles.disabled,
            pressed && !disabled && !saving && styles.pressed,
          ]}
        >
          <Ionicons color={colors.accentInk} name="download-outline" size={18} />
          <Text style={styles.primaryText}>{saving ? 'Sauvegarde…' : 'Sauvegarder'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceRaised,
  },
  header: {
    padding: spacing.lg,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badgeText: {
    color: colors.success,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  previewShell: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  preview: {
    maxWidth: '100%',
    aspectRatio: 9 / 16,
    backgroundColor: colors.background,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
  },
  action: {
    width: '100%',
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  primaryAction: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  primaryText: {
    color: colors.accentInk,
    fontSize: 14,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.45,
  },
});
