import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing } from '../theme';
import type { GenerationProgress } from '../types';

export function GenerationStatus({ progress }: { progress: GenerationProgress }) {
  const width = `${Math.max(0, Math.min(100, progress.percent))}%` as `${number}%`;
  return (
    <View
      accessibilityLabel={progress.label}
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: 100,
        now: Math.round(Math.max(0, Math.min(100, progress.percent))),
        text: `${progress.current} sur ${progress.total}`,
      }}
      style={styles.card}
    >
      <View style={styles.header}>
        <View style={styles.statusCopy}>
          <ActivityIndicator color={colors.accent} size="small" />
          <Text numberOfLines={1} style={styles.label}>
            {progress.label}
          </Text>
        </View>
        <Text style={styles.elapsed}>{progress.elapsedSeconds}s</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width }]} />
      </View>
      {progress.total > 1 ? (
        <Text style={styles.detail}>
          {progress.current} sur {progress.total}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  statusCopy: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  elapsed: {
    color: colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  track: {
    height: 4,
    overflow: 'hidden',
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  fill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  detail: {
    color: colors.textFaint,
    fontSize: 11,
  },
});
