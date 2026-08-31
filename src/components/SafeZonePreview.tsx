import Slider from '@react-native-community/slider';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing } from '../theme';

interface SafeZonePreviewProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

export function SafeZonePreview({ value, onChange, disabled = false }: SafeZonePreviewProps) {
  const textTop = 7 + (56 * value) / 100;
  const narrow = textTop + 12 > 45;

  return (
    <View style={styles.wrapper}>
      <View style={styles.sliderColumn}>
        <Text style={styles.sliderLabel}>Haut</Text>
        <View style={styles.sliderTrack}>
          <Slider
            accessibilityLabel="Position verticale du texte"
            accessibilityState={{ disabled }}
            accessibilityValue={{ min: 0, max: 100, now: Math.round(value), text: `${Math.round(value)} %` }}
            disabled={disabled}
            maximumTrackTintColor={colors.borderStrong}
            maximumValue={100}
            minimumTrackTintColor={colors.accent}
            minimumValue={0}
            onValueChange={onChange}
            step={1}
            style={styles.slider}
            thumbTintColor={colors.text}
            value={value}
          />
        </View>
        <Text style={styles.sliderLabel}>Bas</Text>
      </View>

      <View style={styles.preview}>
        <View style={[styles.unsafe, styles.unsafeTop]} />
        <View style={[styles.unsafe, styles.unsafeUpperLeft]} />
        <View style={[styles.unsafe, styles.unsafeUpperRight]} />
        <View style={[styles.unsafe, styles.unsafeLowerLeft]} />
        <View style={[styles.unsafe, styles.unsafeLowerRight]} />
        <View style={[styles.unsafe, styles.unsafeBottom]} />
        <View
          style={[
            styles.sampleWrap,
            {
              top: `${textTop}%`,
              left: '8%',
              right: narrow ? '18%' : '8%',
            },
          ]}
        >
          <Text style={styles.sampleText}>Lorem ipsum dolor sit amet et consectetur adipiscing</Text>
        </View>
        <View style={styles.positionBadge}>
          <Text style={styles.positionText}>{Math.round(value)}%</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: spacing.lg,
  },
  sliderColumn: {
    width: 40,
    height: 270,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sliderLabel: {
    color: colors.textMuted,
    fontSize: 10,
  },
  sliderTrack: {
    width: 34,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slider: {
    width: 220,
    height: 34,
    transform: [{ rotate: '90deg' }],
  },
  preview: {
    width: 162,
    aspectRatio: 9 / 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  unsafe: {
    position: 'absolute',
    backgroundColor: colors.unsafe,
  },
  unsafeTop: {
    top: 0,
    left: 0,
    right: 0,
    height: '7%',
  },
  unsafeUpperLeft: {
    top: '7%',
    left: 0,
    width: '8%',
    height: '38%',
  },
  unsafeUpperRight: {
    top: '7%',
    right: 0,
    width: '8%',
    height: '38%',
  },
  unsafeLowerLeft: {
    top: '45%',
    left: 0,
    width: '8%',
    height: '30%',
  },
  unsafeLowerRight: {
    top: '45%',
    right: 0,
    width: '18%',
    height: '30%',
  },
  unsafeBottom: {
    left: 0,
    right: 0,
    bottom: 0,
    height: '25%',
  },
  sampleWrap: {
    position: 'absolute',
    minHeight: '12%',
    justifyContent: 'center',
  },
  sampleText: {
    color: colors.text,
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '700',
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  positionBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.overlay,
  },
  positionText: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
  },
});
