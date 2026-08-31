import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';

import { deleteMedia, generateBulkVideo } from '../api';
import { createAndShareBulkArchive } from '../files';
import { colors, radii, spacing } from '../theme';
import type {
  GenerationProgress,
  LibraryKey,
  MediaItem,
  MediaLibrary,
} from '../types';
import {
  buildBulkCombinations,
  errorMessage,
  filterByTags,
  mediaId,
  selectedMedia,
  selectedTexts,
  textId,
  uniqueTags,
} from '../utils';
import { IconButton, PrimaryButton } from '../components/Button';
import { CountModal } from '../components/CountModal';
import { GenerationStatus } from '../components/GenerationStatus';
import { MediaSelector } from '../components/MediaSelector';
import { MusicSelector } from '../components/MusicSelector';
import { SafeZonePreview } from '../components/SafeZonePreview';
import { SectionHeader } from '../components/Section';
import { TagFilterPanel } from '../components/Tags';
import { TextSelector } from '../components/TextSelector';

interface BulkScreenProps {
  library: MediaLibrary;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  active: boolean;
  disabled: boolean;
}

type SelectionState = Record<LibraryKey, Set<string>>;
type FilterState = Record<LibraryKey, Set<string>>;

const emptySets = (): SelectionState => ({
  hooks: new Set(),
  captures: new Set(),
  musiques: new Set(),
  textes: new Set(),
});

const libraryKeys: LibraryKey[] = ['hooks', 'captures', 'musiques', 'textes'];

function reconcileSets(current: SelectionState, allowed: SelectionState) {
  let changed = false;
  const next = { ...current };

  for (const key of libraryKeys) {
    const reconciled = new Set([...current[key]].filter((value) => allowed[key].has(value)));
    if (reconciled.size !== current[key].size) changed = true;
    next[key] = reconciled;
  }

  return changed ? next : current;
}

const KEEP_AWAKE_TAG = 'scaylit-bulk-generation';

function SelectAllButton({
  active,
  onPress,
  disabled,
}: {
  active: boolean;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.selectAll,
        active && styles.selectAllActive,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.selectAllText, active && styles.selectAllTextActive]}>
        {active ? 'Désélectionner' : 'Tout sélectionner'}
      </Text>
    </Pressable>
  );
}

export function BulkScreen({
  library,
  refreshing,
  onRefresh,
  onBusyChange,
  active,
  disabled,
}: BulkScreenProps) {
  const [hookIndex, setHookIndex] = useState(0);
  const [captureIndex, setCaptureIndex] = useState(0);
  const [selected, setSelected] = useState<SelectionState>(emptySets);
  const [filters, setFilters] = useState<FilterState>(emptySets);
  const [openFilter, setOpenFilter] = useState<LibraryKey | null>(null);
  const [textPosition, setTextPosition] = useState(50);
  const [countModal, setCountModal] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const filteredHooks = useMemo(
    () => filterByTags(library.hooks, filters.hooks),
    [filters.hooks, library.hooks],
  );
  const filteredCaptures = useMemo(
    () => filterByTags(library.captures, filters.captures),
    [filters.captures, library.captures],
  );
  const filteredMusiques = useMemo(
    () => filterByTags(library.musiques, filters.musiques),
    [filters.musiques, library.musiques],
  );
  const filteredTextes = useMemo(
    () => filterByTags(library.textes, filters.textes),
    [filters.textes, library.textes],
  );

  useEffect(() => {
    const allowedSelections: SelectionState = {
      hooks: new Set(library.hooks.map(mediaId)),
      captures: new Set(library.captures.map(mediaId)),
      musiques: new Set(library.musiques.map(mediaId)),
      textes: new Set(library.textes.map((item, index) => textId(item, index))),
    };
    const allowedFilters: FilterState = {
      hooks: new Set(uniqueTags(library.hooks)),
      captures: new Set(uniqueTags(library.captures)),
      musiques: new Set(uniqueTags(library.musiques)),
      textes: new Set(uniqueTags(library.textes)),
    };

    setSelected((current) => reconcileSets(current, allowedSelections));
    setFilters((current) => reconcileSets(current, allowedFilters));
  }, [library]);

  const chosenHooks = selectedMedia(library.hooks, selected.hooks, true);
  const chosenCaptures = selectedMedia(library.captures, selected.captures, true);
  const maximum = chosenHooks.length * chosenCaptures.length;
  const generating = progress !== null;

  const updateSelection = (key: LibraryKey, updater: (current: Set<string>) => Set<string>) => {
    if (disabled) return;
    setSelected((current) => ({ ...current, [key]: updater(current[key]) }));
  };

  const toggleSelection = (key: LibraryKey, id: string) => {
    updateSelection(key, (current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleTag = (key: LibraryKey, tag: string) => {
    if (disabled) return;
    setFilters((current) => {
      const nextSet = new Set(current[key]);
      if (nextSet.has(tag)) nextSet.delete(tag);
      else nextSet.add(tag);
      return { ...current, [key]: nextSet };
    });
    updateSelection(key, () => new Set());
  };

  const selectAll = (key: LibraryKey, ids: string[]) => {
    if (disabled) return;
    updateSelection(key, (current) => {
      const allSelected = ids.length > 0 && ids.every((id) => current.has(id));
      const next = new Set(current);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
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
              await onRefresh();
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            })
            .catch((error) => Alert.alert('Suppression impossible', errorMessage(error)))
            .finally(() => onBusyChange(false));
        },
      },
    ]);
  };

  const showCountModal = () => {
    if (disabled || generating) return;
    if (maximum === 0) {
      Alert.alert('Médias manquants', 'Importe au moins un hook et une capture.');
      return;
    }
    setCountModal(true);
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const handleGenerate = async (count: number) => {
    if (disabled || generating) return;
    setCountModal(false);
    const musiques = selectedMedia(library.musiques, selected.musiques, false);
    const textes = selectedTexts(library.textes, selected.textes);
    const combinations = buildBulkCombinations(chosenHooks, chosenCaptures, musiques, textes, count);
    if (combinations.length === 0) return;

    setSummary(null);
    onBusyChange(true);
    const startedAt = Date.now();
    setProgress({
      label: `Génération 0/${combinations.length}`,
      current: 0,
      total: combinations.length,
      percent: 0,
      elapsedSeconds: 0,
    });
    timerRef.current = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      setProgress((current) => (current ? { ...current, elapsedSeconds } : null));
    }, 1000);

    try {
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      const generated = [];
      let failures = 0;
      let firstFailure: string | null = null;

      for (let index = 0; index < combinations.length; index += 1) {
        const combination = combinations[index];
        if (!combination) continue;
        setProgress((current) =>
          current
            ? {
                ...current,
                label: `Génération ${index + 1}/${combinations.length}`,
                current: index + 1,
                percent: (index / combinations.length) * 86,
              }
            : null,
        );
        try {
          generated.push(await generateBulkVideo(combination, textPosition));
        } catch (error) {
          failures += 1;
          firstFailure ??= errorMessage(error, 'Génération impossible.');
        }
      }

      if (generated.length === 0) {
        throw new Error(
          firstFailure
            ? `Aucune vidéo n’a pu être générée. ${firstFailure}`
            : 'Aucune vidéo n’a pu être générée.',
        );
      }

      const archiveResult = await createAndShareBulkArchive(generated, (current, total, label) => {
        setProgress((state) =>
          state
            ? {
                ...state,
                label,
                current,
                total,
                percent: 86 + (current / Math.max(1, total)) * 13,
              }
            : null,
          );
      });
      const readyCount = generated.length - archiveResult.failures;
      failures += archiveResult.failures;
      firstFailure ??= archiveResult.firstError;

      const completion = `${readyCount} vidéo${readyCount > 1 ? 's' : ''} prête${readyCount > 1 ? 's' : ''}${
        failures ? ` · ${failures} échec${failures > 1 ? 's' : ''}` : ''
      }${firstFailure ? `\nPremier échec : ${firstFailure}` : ''}`;
      setSummary(completion);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      Alert.alert('Bulk interrompu', errorMessage(error));
    } finally {
      stopTimer();
      setProgress(null);
      onBusyChange(false);
      await deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    }
  };

  const hookIds = filteredHooks.map(mediaId);
  const captureIds = filteredCaptures.map(mediaId);
  const musicIds = filteredMusiques.map(mediaId);
  const textIds = filteredTextes.map((item) => textId(item, Math.max(0, library.textes.indexOf(item))));

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
          <SectionHeader
            actions={
              <>
                <SelectAllButton
                  active={hookIds.length > 0 && hookIds.every((id) => selected.hooks.has(id))}
                  disabled={disabled}
                  onPress={() => selectAll('hooks', hookIds)}
                />
                <IconButton
                  active={openFilter === 'hooks' || filters.hooks.size > 0}
                  icon="filter"
                  label="Filtrer les hooks"
                  disabled={disabled}
                  onPress={() => setOpenFilter((current) => (current === 'hooks' ? null : 'hooks'))}
                />
              </>
            }
            subtitle={selected.hooks.size === 0 ? 'Aucune sélection = tous' : `${selected.hooks.size} sélectionné(s)`}
            title="Hooks"
          />
          {openFilter === 'hooks' ? (
            <TagFilterPanel
              disabled={disabled}
              emptyLabel="Aucun tag disponible"
              onToggle={(tag) => toggleTag('hooks', tag)}
              selected={filters.hooks}
              tags={uniqueTags(library.hooks)}
            />
          ) : null}
          <MediaSelector
            active={active}
            compact
            currentIndex={hookIndex}
            disabled={disabled}
            emptyLabel="Aucun hook dans ce filtre."
            items={filteredHooks}
            onChangeIndex={setHookIndex}
            onDelete={handleDelete}
            onToggleSelection={(id) => toggleSelection('hooks', id)}
            selectedIds={selected.hooks}
          />
        </View>

        <View style={styles.section}>
          <SectionHeader
            actions={
              <>
                <SelectAllButton
                  active={captureIds.length > 0 && captureIds.every((id) => selected.captures.has(id))}
                  disabled={disabled}
                  onPress={() => selectAll('captures', captureIds)}
                />
                <IconButton
                  active={openFilter === 'captures' || filters.captures.size > 0}
                  icon="filter"
                  label="Filtrer les captures"
                  disabled={disabled}
                  onPress={() => setOpenFilter((current) => (current === 'captures' ? null : 'captures'))}
                />
              </>
            }
            subtitle={selected.captures.size === 0 ? 'Aucune sélection = toutes' : `${selected.captures.size} sélectionnée(s)`}
            title="Screen recordings"
          />
          {openFilter === 'captures' ? (
            <TagFilterPanel
              disabled={disabled}
              emptyLabel="Aucun tag disponible"
              onToggle={(tag) => toggleTag('captures', tag)}
              selected={filters.captures}
              tags={uniqueTags(library.captures)}
            />
          ) : null}
          <MediaSelector
            active={active}
            compact
            currentIndex={captureIndex}
            disabled={disabled}
            emptyLabel="Aucune capture dans ce filtre."
            items={filteredCaptures}
            onChangeIndex={setCaptureIndex}
            onDelete={handleDelete}
            onToggleSelection={(id) => toggleSelection('captures', id)}
            selectedIds={selected.captures}
          />
        </View>

        <View style={styles.section}>
          <SectionHeader
            actions={
              <>
                <SelectAllButton
                  active={musicIds.length > 0 && musicIds.every((id) => selected.musiques.has(id))}
                  disabled={disabled}
                  onPress={() => selectAll('musiques', musicIds)}
                />
                <IconButton
                  active={openFilter === 'musiques' || filters.musiques.size > 0}
                  icon="filter"
                  label="Filtrer les musiques"
                  disabled={disabled}
                  onPress={() => setOpenFilter((current) => (current === 'musiques' ? null : 'musiques'))}
                />
              </>
            }
            subtitle={selected.musiques.size === 0 ? 'Optionnel' : `${selected.musiques.size} sélectionnée(s)`}
            title="Musiques"
          />
          {openFilter === 'musiques' ? (
            <TagFilterPanel
              disabled={disabled}
              emptyLabel="Aucun tag disponible"
              onToggle={(tag) => toggleTag('musiques', tag)}
              selected={filters.musiques}
              tags={uniqueTags(library.musiques)}
            />
          ) : null}
          <MusicSelector
            active={active}
            disabled={disabled}
            items={filteredMusiques}
            onToggleSelection={(id) => toggleSelection('musiques', id)}
            selectedIds={selected.musiques}
          />
        </View>

        <View style={styles.section}>
          <SectionHeader
            actions={
              <>
                <SelectAllButton
                  active={textIds.length > 0 && textIds.every((id) => selected.textes.has(id))}
                  disabled={disabled}
                  onPress={() => selectAll('textes', textIds)}
                />
                <IconButton
                  active={openFilter === 'textes' || filters.textes.size > 0}
                  icon="filter"
                  label="Filtrer les textes"
                  disabled={disabled}
                  onPress={() => setOpenFilter((current) => (current === 'textes' ? null : 'textes'))}
                />
              </>
            }
            subtitle={selected.textes.size === 0 ? 'Optionnel' : `${selected.textes.size} sélectionné(s)`}
            title="Textes"
          />
          {openFilter === 'textes' ? (
            <TagFilterPanel
              disabled={disabled}
              emptyLabel="Aucun tag disponible"
              onToggle={(tag) => toggleTag('textes', tag)}
              selected={filters.textes}
              tags={uniqueTags(library.textes)}
            />
          ) : null}
          <TextSelector
            allItems={library.textes}
            disabled={disabled}
            items={filteredTextes}
            onToggleSelection={(id) => toggleSelection('textes', id)}
            selectedIds={selected.textes}
          />
          <SafeZonePreview disabled={disabled} onChange={setTextPosition} value={textPosition} />
        </View>

        {progress ? <GenerationStatus progress={progress} /> : null}
        {summary ? (
          <View style={styles.summary}>
            <Text style={styles.summaryEyebrow}>Lot terminé</Text>
            <Text style={styles.summaryText}>{summary}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          disabled={disabled || maximum === 0}
          icon="layers"
          label={generating ? 'Génération du lot…' : 'Bulk Générer'}
          loading={generating}
          onPress={showCountModal}
        />
      </View>
      <CountModal
        maximum={Math.max(1, maximum)}
        onCancel={() => setCountModal(false)}
        onConfirm={(count) => void handleGenerate(count)}
        visible={countModal}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: 56,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: 134,
  },
  section: {
    minWidth: 0,
  },
  selectAll: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  selectAllActive: {
    borderColor: colors.text,
    backgroundColor: colors.text,
  },
  selectAllText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
  },
  selectAllTextActive: {
    color: colors.background,
  },
  summary: {
    borderWidth: 1,
    borderColor: '#274733',
    borderRadius: radii.md,
    backgroundColor: '#102017',
    padding: spacing.lg,
  },
  summaryEyebrow: {
    color: colors.success,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  summaryText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 5,
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
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.42,
  },
});
