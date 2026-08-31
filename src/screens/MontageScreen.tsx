import { useRef, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';

import { deleteMedia, generateSingle } from '../api';
import { colors, spacing } from '../theme';
import type { GeneratedVideo, GenerationProgress, MediaItem, MediaLibrary } from '../types';
import { errorMessage } from '../utils';
import { GenerationStatus } from '../components/GenerationStatus';
import { MediaSelector } from '../components/MediaSelector';
import { PrimaryButton } from '../components/Button';
import { ResultCard } from '../components/ResultCard';
import { SectionHeader } from '../components/Section';

interface MontageScreenProps {
  library: MediaLibrary;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  active: boolean;
  disabled: boolean;
}

const KEEP_AWAKE_TAG = 'scaylit-single-generation';

export function MontageScreen({
  library,
  refreshing,
  onRefresh,
  onBusyChange,
  active,
  disabled,
}: MontageScreenProps) {
  const [hookIndex, setHookIndex] = useState(0);
  const [captureIndex, setCaptureIndex] = useState(0);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [result, setResult] = useState<GeneratedVideo | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedHook = library.hooks[hookIndex];
  const selectedCapture = library.captures[captureIndex];
  const generating = progress !== null;

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const handleDelete = (item: MediaItem) => {
    if (disabled) return;
    Alert.alert('Supprimer ce fichier ?', item.name, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          onBusyChange(true);
          void deleteMedia(item.public_id, 'video')
            .then(async () => {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              await onRefresh();
            })
            .catch((error) => Alert.alert('Suppression impossible', errorMessage(error)))
            .finally(() => onBusyChange(false));
        },
      },
    ]);
  };

  const handleGenerate = async () => {
    if (disabled || generating) return;
    if (!selectedHook || !selectedCapture) {
      Alert.alert('Médias manquants', 'Importe au moins un hook et une capture.');
      return;
    }

    setResult(null);
    onBusyChange(true);
    const startedAt = Date.now();
    setProgress({ label: 'Préparation du montage…', current: 1, total: 1, percent: 8, elapsedSeconds: 0 });
    timerRef.current = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      setProgress((current) => (current ? { ...current, elapsedSeconds } : null));
    }, 1000);

    try {
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      setProgress((current) => (current ? { ...current, label: 'Assemblage en cours…', percent: 35 } : null));
      const url = await generateSingle(selectedHook.url, selectedCapture.url);
      setProgress((current) => (current ? { ...current, label: 'Vidéo prête', percent: 100 } : null));
      setResult({ url, name: `${selectedHook.name} + ${selectedCapture.name}` });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert('Génération impossible', errorMessage(error));
    } finally {
      stopTimer();
      setProgress(null);
      onBusyChange(false);
      await deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            enabled={!disabled}
            onRefresh={() => {
              if (!disabled) void onRefresh();
            }}
            refreshing={refreshing}
            tintColor={colors.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <SectionHeader title="Hook" />
          <MediaSelector
            active={active}
            currentIndex={hookIndex}
            disabled={disabled}
            emptyLabel="Aucun hook. Ajoute-en un dans Importer."
            items={library.hooks}
            onChangeIndex={setHookIndex}
            onDelete={handleDelete}
          />
        </View>
        <View style={styles.section}>
          <SectionHeader title="Screen recordings" />
          <MediaSelector
            active={active}
            currentIndex={captureIndex}
            disabled={disabled}
            emptyLabel="Aucune capture. Ajoute-en une dans Importer."
            items={library.captures}
            onChangeIndex={setCaptureIndex}
            onDelete={handleDelete}
          />
        </View>
        {progress ? <GenerationStatus progress={progress} /> : null}
        {result ? <ResultCard active={active} result={result} /> : null}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton
          disabled={disabled || !selectedHook || !selectedCapture}
          icon="sparkles"
          label={generating ? 'Génération…' : 'Générer'}
          loading={generating}
          onPress={() => void handleGenerate()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: 52,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: 134,
  },
  section: {
    minWidth: 0,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: 'rgba(5, 5, 5, 0.96)',
  },
});
