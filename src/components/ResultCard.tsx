import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { shareVideo } from '../files';
import { colors, radii, spacing } from '../theme';
import type { GeneratedVideo } from '../types';
import { errorMessage } from '../utils';
import { VideoPreview } from './VideoPreview';

export function ResultCard({ result, active }: { result: GeneratedVideo; active: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [sharing, setSharing] = useState(false);

  const handleShare = async () => {
    setSharing(true);
    try {
      await shareVideo(result.url, result.name);
    } catch (error) {
      Alert.alert('Partage impossible', errorMessage(error));
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.badge}>
          <Ionicons color={colors.success} name="checkmark-circle" size={17} />
          <Text style={styles.badgeText}>Vidéo prête</Text>
        </View>
        <Text numberOfLines={2} style={styles.name}>
          {result.name}
        </Text>
      </View>
      {expanded ? (
        <View style={styles.preview}>
          <VideoPreview active={active} controls url={result.url} />
        </View>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={expanded ? 'Réduire l’aperçu' : 'Afficher l’aperçu'}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((value) => !value)}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Ionicons color={colors.text} name={expanded ? 'chevron-up' : 'play-outline'} size={17} />
          <Text style={styles.actionText}>{expanded ? 'Réduire' : 'Aperçu'}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Enregistrer ou partager la vidéo"
          accessibilityRole="button"
          accessibilityState={{ disabled: sharing, busy: sharing }}
          disabled={sharing}
          onPress={() => void handleShare()}
          style={({ pressed }) => [styles.action, styles.primaryAction, pressed && styles.pressed]}
        >
          <Ionicons color={colors.accentInk} name="share-outline" size={17} />
          <Text style={styles.primaryText}>{sharing ? 'Préparation…' : 'Enregistrer'}</Text>
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
  name: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
    marginTop: spacing.sm,
  },
  preview: {
    width: '100%',
    aspectRatio: 9 / 16,
    maxHeight: 520,
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
    flex: 1,
    height: 42,
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
  actionText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  primaryText: {
    color: colors.accentInk,
    fontSize: 12,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.72,
  },
});
