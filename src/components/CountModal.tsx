import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors, radii, spacing } from '../theme';
import { PrimaryButton } from './Button';

interface CountModalProps {
  visible: boolean;
  maximum: number;
  onCancel: () => void;
  onConfirm: (count: number) => void;
}

export function CountModal({ visible, maximum, onCancel, onConfirm }: CountModalProps) {
  const [value, setValue] = useState(String(maximum));

  useEffect(() => {
    if (visible) setValue(String(maximum));
  }, [maximum, visible]);

  const parsed = Number.parseInt(value, 10);
  const count = Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, maximum)) : 1;

  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.card}>
          <Text style={styles.title}>Combien de vidéos ?</Text>
          <Text style={styles.subtitle}>Jusqu’à {maximum} combinaisons uniques.</Text>
          <TextInput
            accessibilityLabel="Nombre de vidéos à générer"
            autoFocus
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={setValue}
            placeholder="1"
            placeholderTextColor={colors.textFaint}
            selectTextOnFocus
            style={styles.input}
            value={value}
          />
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={onCancel} style={styles.cancel}>
              <Text style={styles.cancelText}>Annuler</Text>
            </Pressable>
            <View style={styles.confirm}>
              <PrimaryButton compact label={`Générer ${count}`} onPress={() => onConfirm(count)} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.xl,
  },
  title: {
    color: colors.text,
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: spacing.sm,
  },
  input: {
    height: 58,
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.background,
    marginTop: spacing.xl,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  cancel: {
    height: 46,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  cancelText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  confirm: {
    flex: 1,
  },
});
