import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { PrimaryButton } from '../components/Button';
import { normalizeApiBaseUrl } from '../config';
import { colors, radii, spacing } from '../theme';
import { errorMessage } from '../utils';

type ConnectionState = 'checking' | 'connected' | 'error';
type DisplayConnectionState = ConnectionState | 'unsaved';

interface SettingsScreenProps {
  apiBaseUrl: string;
  defaultApiBaseUrl: string;
  connectionError: string | null;
  connectionState: ConnectionState;
  disabled: boolean;
  onOpenBulk: () => void;
  onResetApiBaseUrl: () => Promise<string>;
  onSaveApiBaseUrl: (value: string) => Promise<string>;
}

function checkApiBaseUrl(value: string): { url: string | null; error: string | null } {
  try {
    return { url: normalizeApiBaseUrl(value), error: null };
  } catch (error) {
    return { url: null, error: value.trim() ? errorMessage(error, 'Entre une adresse web valide.') : null };
  }
}

const connectionCopy: Record<DisplayConnectionState, string> = {
  checking: 'Vérification…',
  connected: 'Worker connecté',
  error: 'Connexion impossible',
  unsaved: 'Non enregistré',
};

export function SettingsScreen({
  apiBaseUrl,
  defaultApiBaseUrl,
  connectionError,
  connectionState,
  disabled,
  onOpenBulk,
  onResetApiBaseUrl,
  onSaveApiBaseUrl,
}: SettingsScreenProps) {
  const [draftUrl, setDraftUrl] = useState(apiBaseUrl);
  const [pendingAction, setPendingAction] = useState<'save' | 'reset' | null>(null);

  useEffect(() => {
    setDraftUrl(apiBaseUrl);
  }, [apiBaseUrl]);

  const { url: normalizedDraft, error: draftError } = checkApiBaseUrl(draftUrl);
  const hasChanges = normalizedDraft !== null && normalizedDraft !== apiBaseUrl;
  const canReset = apiBaseUrl !== defaultApiBaseUrl || draftUrl !== apiBaseUrl;
  const controlsDisabled = disabled || pendingAction !== null;
  const displayConnectionState: DisplayConnectionState =
    normalizedDraft === apiBaseUrl ? connectionState : 'unsaved';

  const handleSave = async () => {
    if (!normalizedDraft || controlsDisabled || !hasChanges) return;
    setPendingAction('save');
    try {
      const savedUrl = await onSaveApiBaseUrl(normalizedDraft);
      setDraftUrl(savedUrl);
      Alert.alert('Configuration enregistrée', 'Scaylit utilise maintenant ce Worker Cloudflare.');
    } catch (error) {
      Alert.alert('Enregistrement impossible', errorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  const handleReset = async () => {
    if (controlsDisabled || !canReset) return;
    setPendingAction('reset');
    try {
      const savedUrl = await onResetApiBaseUrl();
      setDraftUrl(savedUrl);
      Alert.alert('Configuration rétablie', 'L’adresse Cloudflare par défaut est de nouveau utilisée.');
    } catch (error) {
      Alert.alert('Réinitialisation impossible', errorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={86}
      style={styles.screen}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text style={styles.title}>Réglages</Text>
          <Text style={styles.subtitle}>Outils avancés et connexion à ton stockage.</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Outils</Text>
          <Pressable
            accessibilityHint="Ouvre la génération de plusieurs montages"
            accessibilityRole="button"
            disabled={disabled}
            onPress={onOpenBulk}
            style={({ pressed }) => [
              styles.toolCard,
              disabled && styles.disabled,
              pressed && !disabled && styles.pressed,
            ]}
          >
            <View style={styles.toolIcon}>
              <Ionicons color={colors.accent} name="layers" size={23} />
            </View>
            <View style={styles.toolCopy}>
              <View style={styles.toolTitleRow}>
                <Text style={styles.toolTitle}>Bulk</Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>LOT</Text>
                </View>
              </View>
              <Text style={styles.toolSubtitle}>Créer plusieurs variantes en une seule fois.</Text>
            </View>
            <Ionicons color={colors.textFaint} name="chevron-forward" size={20} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>Cloudflare</Text>
            <View
              accessibilityLabel={connectionCopy[displayConnectionState]}
              style={[styles.status, styles[`status_${displayConnectionState}`]]}
            >
              {displayConnectionState === 'checking' ? (
                <ActivityIndicator color={colors.textMuted} size="small" />
              ) : (
                <View
                  style={[styles.statusDot, styles[`statusDot_${displayConnectionState}`]]}
                />
              )}
              <Text style={styles.statusText}>{connectionCopy[displayConnectionState]}</Text>
            </View>
          </View>

          <View style={styles.cloudCard}>
            <Text style={styles.fieldLabel}>URL du Worker</Text>
            <Text style={styles.fieldHelp}>
              Colle l’adresse publique du Worker relié à ton bucket R2.
            </Text>
            <TextInput
              accessibilityLabel="URL du Worker Cloudflare"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!controlsDisabled}
              keyboardType="url"
              onChangeText={setDraftUrl}
              onSubmitEditing={() => void handleSave()}
              placeholder="https://mon-worker.workers.dev"
              placeholderTextColor={colors.textFaint}
              returnKeyType="done"
              selectTextOnFocus
              style={[styles.input, draftError !== null && styles.inputInvalid]}
              value={draftUrl}
            />
            {draftError ? (
              <Text accessibilityRole="alert" style={styles.validationError}>
                {draftError}
              </Text>
            ) : null}
            {displayConnectionState === 'error' && connectionError ? (
              <View accessibilityRole="alert" style={styles.connectionError}>
                <Ionicons color={colors.danger} name="alert-circle-outline" size={17} />
                <Text numberOfLines={3} style={styles.connectionErrorText}>
                  {connectionError}
                </Text>
              </View>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: controlsDisabled || !canReset }}
                disabled={controlsDisabled || !canReset}
                onPress={() => void handleReset()}
                style={({ pressed }) => [
                  styles.resetButton,
                  (controlsDisabled || !canReset) && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {pendingAction === 'reset' ? (
                  <ActivityIndicator color={colors.textMuted} size="small" />
                ) : (
                  <Text style={styles.resetLabel}>Par défaut</Text>
                )}
              </Pressable>
              <View style={styles.saveButton}>
                <PrimaryButton
                  compact
                  disabled={controlsDisabled || !normalizedDraft || !hasChanges}
                  icon="checkmark"
                  label="Enregistrer"
                  loading={pendingAction === 'save'}
                  onPress={() => void handleSave()}
                />
              </View>
            </View>
          </View>
        </View>

        <View style={styles.securityCard}>
          <View style={styles.securityIcon}>
            <Ionicons color={colors.success} name="shield-checkmark" size={21} />
          </View>
          <View style={styles.securityCopy}>
            <Text style={styles.securityTitle}>Tes clés R2 restent dans Cloudflare</Text>
            <Text style={styles.securityText}>
              Le bucket, l’endpoint et les clés secrètes se configurent dans Cloudflare. Pour changer
              de stockage, connecte un autre Worker puis colle son URL ici.
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: spacing.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -1.1,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  section: {
    gap: spacing.md,
  },
  sectionHeading: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  toolCard: {
    minHeight: 86,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceRaised,
  },
  toolIcon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#252A08',
  },
  toolCopy: {
    flex: 1,
    minWidth: 0,
  },
  toolTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  toolTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.35,
  },
  toolSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  badgeText: {
    color: colors.accentInk,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  status: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderRadius: radii.pill,
  },
  status_checking: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  status_connected: {
    borderColor: '#254A34',
    backgroundColor: '#10251A',
  },
  status_error: {
    borderColor: '#4B2427',
    backgroundColor: colors.dangerSoft,
  },
  status_unsaved: {
    borderColor: '#51481A',
    backgroundColor: '#211E0C',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusDot_checking: {
    backgroundColor: colors.textMuted,
  },
  statusDot_connected: {
    backgroundColor: colors.success,
  },
  statusDot_error: {
    backgroundColor: colors.danger,
  },
  statusDot_unsaved: {
    backgroundColor: colors.accentWarm,
  },
  statusText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  cloudCard: {
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceRaised,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  fieldHelp: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  input: {
    minHeight: 50,
    color: colors.text,
    fontSize: 13,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.background,
  },
  inputInvalid: {
    borderColor: colors.danger,
  },
  validationError: {
    color: colors.danger,
    fontSize: 11,
    marginTop: 6,
  },
  connectionError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.dangerSoft,
  },
  connectionErrorText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  resetButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceSoft,
  },
  resetLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  saveButton: {
    flex: 1,
  },
  securityCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: '#254A34',
    borderRadius: radii.lg,
    backgroundColor: '#0D1B13',
  },
  securityIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#173422',
  },
  securityCopy: {
    flex: 1,
  },
  securityTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
  },
  securityText: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 4,
  },
  disabled: {
    opacity: 0.42,
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.99 }],
  },
});
