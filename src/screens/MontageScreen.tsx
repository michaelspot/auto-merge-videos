import {
  createContext,
  type ComponentProps,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Alert,
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useIsFocused, usePreventRemove } from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';

import { deleteMedia, generateSingle } from '../api';
import { PrimaryButton } from '../components/Button';
import { GenerationStatus } from '../components/GenerationStatus';
import { MediaSelector } from '../components/MediaSelector';
import { ResultCard } from '../components/ResultCard';
import { TagChips } from '../components/Tags';
import { colors, radii, spacing } from '../theme';
import type { ClipTrim, GeneratedVideo, GenerationProgress, MediaItem, MediaLibrary } from '../types';
import { errorMessage, filterByTags, mediaId, uniqueTags } from '../utils';

interface MontageScreenProps {
  library: MediaLibrary;
  onTrimChange: (item: MediaItem, trim: ClipTrim | null) => void;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  active: boolean;
  disabled: boolean;
}

type MontageStackParamList = {
  Hook: undefined;
  Capture: undefined;
  Export: undefined;
};

interface MontageFlowContextValue {
  active: boolean;
  onTrimChange: (item: MediaItem, trim: ClipTrim | null) => void;
  selectionDisabled: boolean;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  hookTags: string[];
  captureTags: string[];
  hookFilters: Set<string>;
  captureFilters: Set<string>;
  filteredHooks: MediaItem[];
  filteredCaptures: MediaItem[];
  hookIndex: number;
  captureIndex: number;
  selectedHook: MediaItem | null;
  selectedCapture: MediaItem | null;
  progress: GenerationProgress | null;
  result: GeneratedVideo | null;
  generationError: string | null;
  generating: boolean;
  selectHook: (index: number) => void;
  selectCapture: (index: number) => void;
  toggleHookFilter: (tag: string) => void;
  toggleCaptureFilter: (tag: string) => void;
  handleDelete: (item: MediaItem) => void;
  generate: () => Promise<void>;
  clearGeneratedOutput: () => void;
}

const KEEP_AWAKE_TAG = 'scaylit-single-generation';
const MontageStack = createNativeStackNavigator<MontageStackParamList>();
const MontageFlowContext = createContext<MontageFlowContextValue | null>(null);

function toggleSetValue(current: Set<string>, value: string) {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function reconcileTags(current: Set<string>, available: string[]) {
  const allowed = new Set(available);
  const next = new Set([...current].filter((tag) => allowed.has(tag)));
  if (next.size === current.size && [...next].every((tag) => current.has(tag))) return current;
  return next;
}

function useMontageFlow() {
  const value = useContext(MontageFlowContext);
  if (!value) throw new Error('MontageFlowContext is missing.');
  return value;
}

interface SelectionStepProps {
  title: 'Hook' | 'Capture';
  onTrimChange: (item: MediaItem, trim: ClipTrim | null) => void;
  actionLabel: string;
  actionIcon?: ComponentProps<typeof Ionicons>['name'];
  actionDisabled: boolean;
  onAction: () => void;
  tags: string[];
  filters: Set<string>;
  onToggleFilter: (tag: string) => void;
  items: MediaItem[];
  currentIndex: number;
  onChangeIndex: (index: number) => void;
  emptyLabel: string;
  active: boolean;
  disabled: boolean;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onDelete: (item: MediaItem) => void;
}

function SelectionStep({
  title,
  onTrimChange,
  actionLabel,
  actionIcon,
  actionDisabled,
  onAction,
  tags,
  filters,
  onToggleFilter,
  items,
  currentIndex,
  onChangeIndex,
  emptyLabel,
  active,
  disabled,
  refreshing,
  onRefresh,
  onDelete,
}: SelectionStepProps) {
  const [selectorMaxHeight, setSelectorMaxHeight] = useState<number>();

  const handleSelectorLayout = useCallback((event: LayoutChangeEvent) => {
    const availableHeight = event.nativeEvent.layout.height - spacing.sm - spacing.md;
    setSelectorMaxHeight(Math.max(120, availableHeight));
  }, []);

  useEffect(() => {
    if (active) AccessibilityInfo.announceForAccessibility(`${title}, étape du montage`);
  }, [active, title]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <View style={styles.headerAction}>
            <PrimaryButton
              compact
              disabled={actionDisabled}
              icon={actionIcon}
              label={actionLabel}
              onPress={onAction}
            />
          </View>
        </View>

        <View style={styles.filters}>
          <Ionicons color={colors.textFaint} name="options-outline" size={16} />
          <View style={styles.filterChips}>
            <TagChips
              disabled={disabled}
              emptyLabel="Aucun filtre disponible"
              onToggle={onToggleFilter}
              selected={filters}
              tags={tags}
            />
          </View>
        </View>
      </View>

      <View onLayout={handleSelectorLayout} style={styles.selectorPage}>
        {/* Wait for the available height so the 9/16 preview mounts at its final size (no jump). */}
        {selectorMaxHeight === undefined ? null : <MediaSelector
          active={active}
          currentIndex={currentIndex}
          disabled={disabled}
          emptyLabel={emptyLabel}
          items={items}
          layout="side"
          maxHeight={selectorMaxHeight}
          onChangeIndex={onChangeIndex}
          onDelete={onDelete}
          onRefresh={onRefresh}
          onTrimChange={onTrimChange}
          refreshing={refreshing}
        />}
      </View>
    </View>
  );
}

function HookStepScreen({ navigation }: NativeStackScreenProps<MontageStackParamList, 'Hook'>) {
  const flow = useMontageFlow();
  const focused = useIsFocused();
  const goToCapture = useCallback(() => navigation.navigate('Capture'), [navigation]);

  return (
    <SelectionStep
      actionDisabled={flow.selectionDisabled || !flow.selectedHook}
      actionLabel="Suivant"
      active={flow.active && focused}
      currentIndex={flow.hookIndex}
      disabled={flow.selectionDisabled}
      emptyLabel="Aucun hook dans ce filtre."
      filters={flow.hookFilters}
      items={flow.filteredHooks}
      onAction={goToCapture}
      onChangeIndex={flow.selectHook}
      onDelete={flow.handleDelete}
      onRefresh={flow.onRefresh}
      onToggleFilter={flow.toggleHookFilter}
      onTrimChange={flow.onTrimChange}
      refreshing={flow.refreshing}
      tags={flow.hookTags}
      title="Hook"
    />
  );
}

function CaptureStepScreen({
  navigation,
}: NativeStackScreenProps<MontageStackParamList, 'Capture'>) {
  const flow = useMontageFlow();
  const focused = useIsFocused();
  const generate = flow.generate;
  usePreventRemove(flow.selectionDisabled || !flow.active, () => undefined);
  const openExportAndGenerate = useCallback(() => {
    navigation.navigate('Export');
    void generate();
  }, [generate, navigation]);

  return (
    <SelectionStep
      actionDisabled={
        flow.selectionDisabled || !flow.selectedHook || !flow.selectedCapture
      }
      actionIcon="sparkles"
      actionLabel="Générer"
      active={flow.active && focused}
      currentIndex={flow.captureIndex}
      disabled={flow.selectionDisabled}
      emptyLabel="Aucune capture dans ce filtre."
      filters={flow.captureFilters}
      items={flow.filteredCaptures}
      onAction={openExportAndGenerate}
      onChangeIndex={flow.selectCapture}
      onDelete={flow.handleDelete}
      onRefresh={flow.onRefresh}
      onToggleFilter={flow.toggleCaptureFilter}
      onTrimChange={flow.onTrimChange}
      refreshing={flow.refreshing}
      tags={flow.captureTags}
      title="Capture"
    />
  );
}

function ExportStepScreen({ navigation }: NativeStackScreenProps<MontageStackParamList, 'Export'>) {
  const flow = useMontageFlow();
  const focused = useIsFocused();
  const generate = flow.generate;
  const clearGeneratedOutput = flow.clearGeneratedOutput;
  usePreventRemove(flow.selectionDisabled || !flow.active, () => undefined);
  const startNewMontage = useCallback(() => {
    clearGeneratedOutput();
    navigation.popToTop();
  }, [clearGeneratedOutput, navigation]);

  useEffect(() => {
    if (flow.active && focused) AccessibilityInfo.announceForAccessibility('Export, étape du montage');
  }, [flow.active, focused]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text accessibilityRole="header" style={styles.title}>
            Export
          </Text>
          <View style={styles.headerAction}>
            {flow.generationError ? (
              <PrimaryButton
                compact
                disabled={flow.selectionDisabled}
                icon="refresh"
                label="Réessayer"
                onPress={() => void generate()}
              />
            ) : null}
            {flow.result ? (
              <PrimaryButton
                compact
                disabled={flow.selectionDisabled}
                icon="add"
                label="Nouveau"
                onPress={startNewMontage}
              />
            ) : null}
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.exportContent} showsVerticalScrollIndicator={false}>
        {flow.progress ? <GenerationStatus progress={flow.progress} /> : null}

        {flow.generating ? (
          <View style={styles.waitingCard}>
            <View style={styles.waitingIcon}>
              <Ionicons color={colors.accent} name="sparkles" size={28} />
            </View>
            <Text style={styles.waitingTitle}>Création de ta vidéo</Text>
            <Text style={styles.waitingText}>
              Tu peux suivre l’avancement ici. Garde Scaylit ouvert pendant l’assemblage.
            </Text>
          </View>
        ) : null}

        {flow.generationError ? (
          <View accessibilityRole="alert" style={styles.errorCard}>
            <Ionicons color={colors.danger} name="alert-circle-outline" size={24} />
            <Text style={styles.errorTitle}>Le montage n’a pas pu être généré</Text>
            <Text style={styles.errorText}>{flow.generationError}</Text>
          </View>
        ) : null}

        {flow.result ? (
          <ResultCard
            active={flow.active && focused}
            onBusyChange={flow.onBusyChange}
            result={flow.result}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

export function MontageScreen({
  library,
  onTrimChange,
  refreshing,
  onRefresh,
  onBusyChange,
  active,
  disabled,
}: MontageScreenProps) {
  const [selectedHookId, setSelectedHookId] = useState<string | null>(null);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [hookFilters, setHookFilters] = useState<Set<string>>(() => new Set());
  const [captureFilters, setCaptureFilters] = useState<Set<string>>(() => new Set());
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [result, setResult] = useState<GeneratedVideo | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Synchronous guard: two quick taps both see `generating === false` before re-render.
  const generatingRef = useRef(false);

  const hookTags = useMemo(() => uniqueTags(library.hooks), [library.hooks]);
  const captureTags = useMemo(() => uniqueTags(library.captures), [library.captures]);
  const filteredHooks = useMemo(
    () => filterByTags(library.hooks, hookFilters),
    [hookFilters, library.hooks],
  );
  const filteredCaptures = useMemo(
    () => filterByTags(library.captures, captureFilters),
    [captureFilters, library.captures],
  );

  const hookIndex = Math.max(
    0,
    filteredHooks.findIndex((item) => mediaId(item) === selectedHookId),
  );
  const captureIndex = Math.max(
    0,
    filteredCaptures.findIndex((item) => mediaId(item) === selectedCaptureId),
  );
  const selectedHook = filteredHooks[hookIndex] ?? null;
  const selectedCapture = filteredCaptures[captureIndex] ?? null;
  const selectionDisabled = disabled || generating;

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const clearGeneratedOutput = useCallback(() => {
    setProgress(null);
    setResult(null);
    setGenerationError(null);
  }, []);

  const handleTrimChange = useCallback((item: MediaItem, trim: ClipTrim | null) => {
    onTrimChange(item, trim);
    clearGeneratedOutput();
  }, [clearGeneratedOutput, onTrimChange]);

  useEffect(() => {
    setHookFilters((current) => reconcileTags(current, hookTags));
    setCaptureFilters((current) => reconcileTags(current, captureTags));
  }, [captureTags, hookTags]);

  useEffect(() => {
    const nextId = selectedHook?.public_id ?? null;
    if (nextId !== selectedHookId) setSelectedHookId(nextId);
  }, [selectedHook, selectedHookId]);

  useEffect(() => {
    const nextId = selectedCapture?.public_id ?? null;
    if (nextId !== selectedCaptureId) setSelectedCaptureId(nextId);
  }, [selectedCapture, selectedCaptureId]);

  useEffect(
    () => () => {
      stopTimer();
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    },
    [stopTimer],
  );

  const handleDelete = useCallback(
    (item: MediaItem) => {
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
                clearGeneratedOutput();
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                await onRefresh();
              })
              .catch((error) => Alert.alert('Suppression impossible', errorMessage(error)))
              .finally(() => onBusyChange(false));
          },
        },
      ]);
    },
    [clearGeneratedOutput, disabled, onBusyChange, onRefresh],
  );

  const selectHook = useCallback(
    (index: number) => {
      const item = filteredHooks[index];
      if (!item) return;
      setSelectedHookId(item.public_id);
      clearGeneratedOutput();
    },
    [clearGeneratedOutput, filteredHooks],
  );

  const selectCapture = useCallback(
    (index: number) => {
      const item = filteredCaptures[index];
      if (!item) return;
      setSelectedCaptureId(item.public_id);
      clearGeneratedOutput();
    },
    [clearGeneratedOutput, filteredCaptures],
  );

  const toggleHookFilter = useCallback(
    (tag: string) => {
      setHookFilters((current) => toggleSetValue(current, tag));
      setSelectedHookId(null);
      clearGeneratedOutput();
    },
    [clearGeneratedOutput],
  );

  const toggleCaptureFilter = useCallback(
    (tag: string) => {
      setCaptureFilters((current) => toggleSetValue(current, tag));
      setSelectedCaptureId(null);
      clearGeneratedOutput();
    },
    [clearGeneratedOutput],
  );

  const handleGenerate = useCallback(async () => {
    if (disabled || generatingRef.current) return;
    if (!selectedHook || !selectedCapture) {
      Alert.alert('Médias manquants', 'Choisis un hook et une capture.');
      return;
    }
    generatingRef.current = true;

    const hook = selectedHook;
    const capture = selectedCapture;
    setResult(null);
    setGenerationError(null);
    setGenerating(true);
    onBusyChange(true);
    const startedAt = Date.now();
    setProgress({
      label: 'Préparation du montage…',
      current: 0,
      total: 1,
      percent: 6,
      elapsedSeconds: 0,
    });
    stopTimer();
    timerRef.current = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      setProgress((current) =>
        current
          ? {
              ...current,
              elapsedSeconds,
              percent: Math.max(current.percent, Math.min(92, 18 + elapsedSeconds * 1.4)),
            }
          : null,
      );
    }, 1000);

    try {
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
      setProgress((current) =>
        current ? { ...current, label: 'Assemblage en cours…', percent: 18 } : null,
      );
      const url = await generateSingle(hook.public_id, capture.public_id, hook.trim, capture.trim);
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      setProgress({
        label: 'Montage terminé',
        current: 1,
        total: 1,
        percent: 100,
        elapsedSeconds,
      });
      setResult({ url, name: `${hook.name} + ${capture.name}` });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      // Shown in the Export error card (accessibilityRole="alert"), no extra modal.
      setProgress(null);
      setGenerationError(errorMessage(error));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      stopTimer();
      generatingRef.current = false;
      setGenerating(false);
      onBusyChange(false);
      await deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    }
  }, [disabled, onBusyChange, selectedCapture, selectedHook, stopTimer]);

  const flowValue = useMemo<MontageFlowContextValue>(
    () => ({
      active,
      onTrimChange: handleTrimChange,
      selectionDisabled,
      refreshing,
      onRefresh,
      onBusyChange,
      hookTags,
      captureTags,
      hookFilters,
      captureFilters,
      filteredHooks,
      filteredCaptures,
      hookIndex,
      captureIndex,
      selectedHook,
      selectedCapture,
      progress,
      result,
      generationError,
      generating,
      selectHook,
      selectCapture,
      toggleHookFilter,
      toggleCaptureFilter,
      handleDelete,
      generate: handleGenerate,
      clearGeneratedOutput,
    }),
    [
      active,
      captureFilters,
      captureIndex,
      captureTags,
      clearGeneratedOutput,
      filteredCaptures,
      filteredHooks,
      generationError,
      generating,
      handleDelete,
      handleGenerate,
      handleTrimChange,
      hookFilters,
      hookIndex,
      hookTags,
      onBusyChange,
      onRefresh,
      progress,
      refreshing,
      result,
      selectedCapture,
      selectedHook,
      selectionDisabled,
      selectCapture,
      selectHook,
      toggleCaptureFilter,
      toggleHookFilter,
    ],
  );

  return (
    <MontageFlowContext.Provider value={flowValue}>
      <MontageStack.Navigator
        initialRouteName="Hook"
        screenOptions={{
          animation: 'default',
          contentStyle: styles.stackContent,
          freezeOnBlur: true,
          fullScreenGestureEnabled: false,
          gestureEnabled: !selectionDisabled,
          headerShown: false,
          presentation: 'card',
        }}
      >
        <MontageStack.Screen component={HookStepScreen} name="Hook" />
        <MontageStack.Screen component={CaptureStepScreen} name="Capture" />
        <MontageStack.Screen component={ExportStepScreen} name="Export" />
      </MontageStack.Navigator>
    </MontageFlowContext.Provider>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  stackContent: {
    backgroundColor: colors.background,
  },
  header: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 0,
  },
  headerTopRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -1,
  },
  headerAction: {
    minWidth: 104,
  },
  filters: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  filterChips: {
    flex: 1,
    minWidth: 0,
  },
  selectorPage: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  exportContent: {
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  waitingCard: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  waitingIcon: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 29,
    backgroundColor: '#252A08',
  },
  waitingTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginTop: spacing.lg,
  },
  waitingText: {
    maxWidth: 280,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  errorCard: {
    alignItems: 'center',
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: '#4B2427',
    borderRadius: radii.lg,
    backgroundColor: colors.dangerSoft,
  },
  errorTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: spacing.md,
  },
  errorText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
