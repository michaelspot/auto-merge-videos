import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { setAudioModeAsync } from 'expo-audio';
import { StatusBar } from 'expo-status-bar';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { PrimaryButton } from './src/components/Button';
import { TabBar } from './src/components/TabBar';
import { DEFAULT_API_BASE_URL } from './src/config';
import { useAppSettings } from './src/hooks/useAppSettings';
import { useMediaLibrary } from './src/hooks/useMediaLibrary';
import { BulkScreen } from './src/screens/BulkScreen';
import { ImportScreen } from './src/screens/ImportScreen';
import { HiggsfieldScreen } from './src/screens/HiggsfieldScreen';
import { MontageScreen } from './src/screens/MontageScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ScrapScreen } from './src/screens/ScrapScreen';
import { colors, radii, spacing } from './src/theme';
import type { PickedVideo } from './src/mediaPicker';
import type { AppTab } from './src/types';

type SettingsRoute = 'home' | 'bulk';
type ScreenKey = AppTab | 'bulk';

// Hidden screens stay mounted (state kept); memo stops them re-rendering on
// every tab change or busy toggle when their own props did not change.
const Montage = memo(MontageScreen);
const Import = memo(ImportScreen);
const Higgsfield = memo(HiggsfieldScreen);
const Scrap = memo(ScrapScreen);
const Settings = memo(SettingsScreen);
const Bulk = memo(BulkScreen);

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.danger,
  },
};

function ScreenSlot({ visible, children }: { visible: boolean; children: ReactNode }) {
  return (
    <View
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      pointerEvents={visible ? 'auto' : 'none'}
      style={[styles.screen, !visible && styles.hiddenScreen]}
    >
      {children}
    </View>
  );
}

function ScaylitApp() {
  const insets = useSafeAreaInsets();
  const tabBottom = Math.max(spacing.sm, insets.bottom - spacing.md);
  const [tab, setTab] = useState<AppTab>('montage');
  const [higgsfieldVideo, setHiggsfieldVideo] = useState<PickedVideo | null>(null);
  const [settingsRoute, setSettingsRoute] = useState<SettingsRoute>('home');
  const [busyOperations, setBusyOperations] = useState(0);
  const { resetApiBaseUrl, saveApiBaseUrl, settings } = useAppSettings();
  const { library, isLoading, isRefreshing, loadError, refresh, updateClipTrim } = useMediaLibrary();
  const refreshLibrary = useCallback(() => refresh(true), [refresh]);
  const onBusyChange = useCallback((nextBusy: boolean) => {
    setBusyOperations((current) => Math.max(0, current + (nextBusy ? 1 : -1)));
  }, []);
  // Busy = a media operation (import, montage, bulk) is running. It only locks
  // the screens that share the media library and the Worker URL; navigation,
  // Scrap and Higgsfield stay usable.
  const busy = busyOperations > 0;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const libraryCount =
    library.hooks.length + library.captures.length + library.musiques.length + library.textes.length + library.influs.length;
  const bulkActive = tab === 'settings' && settingsRoute === 'bulk';
  const mediaScreenActive = tab === 'montage' || tab === 'import' || bulkActive;
  const libraryAvailable = !isLoading && (!loadError || libraryCount > 0);
  const connectionState =
    isLoading || isRefreshing ? 'checking' : loadError ? 'error' : 'connected';

  // Screens are mounted on first visit only, then kept alive.
  const visibleScreen: ScreenKey = bulkActive ? 'bulk' : tab;
  const [mounted, setMounted] = useState<ReadonlySet<ScreenKey>>(() => new Set([visibleScreen]));
  if (!mounted.has(visibleScreen)) setMounted(new Set(mounted).add(visibleScreen));

  const handleTabChange = useCallback(
    (nextTab: AppTab) => {
      // Tapping Réglages again goes back to its home, like a native tab bar.
      if (nextTab === 'settings' && tab === 'settings' && !busy) setSettingsRoute('home');
      setTab(nextTab);
    },
    [busy, tab],
  );

  // After an import, only redirect if the user is still on the Import tab.
  const goToMontage = useCallback(() => setTab((current) => (current === 'import' ? 'montage' : current)), []);
  const goToImport = useCallback(() => setTab('import'), []);
  const goToHiggsfield = useCallback(() => setTab((current) => (current === 'import' ? 'higgsfield' : current)), []);
  const openBulk = useCallback(() => setSettingsRoute('bulk'), []);

  const sendToHiggsfield = useCallback((video: PickedVideo) => {
    setHiggsfieldVideo(video);
    setTab('higgsfield');
  }, []);

  // Higgsfield may refresh the Influ list, but never while a media operation runs.
  const refreshLibraryWhenIdle = useCallback(
    () => (busyRef.current ? Promise.resolve() : refresh(true)),
    [refresh],
  );

  const handleSaveApiBaseUrl = useCallback(
    async (value: string) => {
      const saved = await saveApiBaseUrl(value);
      await refresh(false, true);
      return saved;
    },
    [refresh, saveApiBaseUrl],
  );

  const handleResetApiBaseUrl = useCallback(async () => {
    const saved = await resetApiBaseUrl();
    await refresh(false, true);
    return saved;
  }, [refresh, resetApiBaseUrl]);

  useEffect(() => {
    void setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: 'mixWithOthers',
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    }).catch(() => undefined);
  }, []);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <StatusBar style="light" />
      {mediaScreenActive && loadError && libraryCount > 0 ? (
        <View accessibilityRole="alert" style={styles.warning}>
          <Ionicons color={colors.accentWarm} name="warning-outline" size={17} />
          <Text numberOfLines={2} style={styles.warningText}>
            Médiathèque non actualisée · {loadError}
          </Text>
          <Pressable
            accessibilityLabel="Réessayer l’actualisation"
            accessibilityRole="button"
            disabled={busy || isRefreshing}
            hitSlop={8}
            onPress={() => void refreshLibrary()}
          >
            <Ionicons color={colors.text} name="refresh" size={18} />
          </Pressable>
        </View>
      ) : null}

      <View style={[styles.body, { paddingBottom: 70 + tabBottom }]}>
        <View style={styles.screens}>
          <ScreenSlot visible={tab === 'montage' && libraryAvailable}>
            {mounted.has('montage') ? (
              <Montage
                active={tab === 'montage' && libraryAvailable}
                disabled={busy}
                library={library}
                onBusyChange={onBusyChange}
                onRefresh={refreshLibrary}
                onTrimChange={updateClipTrim}
                refreshing={isRefreshing}
              />
            ) : null}
          </ScreenSlot>
          <ScreenSlot visible={tab === 'import' && libraryAvailable}>
            {mounted.has('import') ? (
              <Import
                disabled={busy}
                library={library}
                onBusyChange={onBusyChange}
                onNavigateMontage={goToMontage}
                onNavigateHiggsfield={goToHiggsfield}
                onRefresh={refreshLibrary}
                refreshing={isRefreshing}
              />
            ) : null}
          </ScreenSlot>
          <ScreenSlot visible={tab === 'higgsfield'}>
            {mounted.has('higgsfield') ? (
              <Higgsfield
                active={tab === 'higgsfield'}
                video={higgsfieldVideo}
                onVideoChange={setHiggsfieldVideo}
                influs={library.influs}
                libraryError={loadError}
                refreshing={isRefreshing}
                onRefresh={refreshLibraryWhenIdle}
                onImport={goToImport}
              />
            ) : null}
          </ScreenSlot>
          <ScreenSlot visible={tab === 'scrap'}>
            {mounted.has('scrap') ? (
              <Scrap active={tab === 'scrap'} onSendToHiggsfield={sendToHiggsfield} />
            ) : null}
          </ScreenSlot>
          <ScreenSlot visible={tab === 'settings' && settingsRoute === 'home'}>
            {mounted.has('settings') ? (
              <Settings
                apiBaseUrl={settings.apiBaseUrl}
                connectionError={loadError}
                connectionState={connectionState}
                defaultApiBaseUrl={DEFAULT_API_BASE_URL}
                disabled={busy}
                onOpenBulk={openBulk}
                onResetApiBaseUrl={handleResetApiBaseUrl}
                onSaveApiBaseUrl={handleSaveApiBaseUrl}
              />
            ) : null}
          </ScreenSlot>
          <ScreenSlot visible={bulkActive && libraryAvailable}>
            {mounted.has('bulk') ? (
              <>
                <View style={styles.subscreenHeader}>
                  <Pressable
                    accessibilityLabel="Retour aux réglages"
                    accessibilityRole="button"
                    disabled={busy}
                    hitSlop={8}
                    onPress={() => setSettingsRoute('home')}
                    style={({ pressed }) => [
                      styles.backButton,
                      busy && styles.disabled,
                      pressed && !busy && styles.pressed,
                    ]}
                  >
                    <Ionicons color={colors.text} name="chevron-back" size={22} />
                  </Pressable>
                  <View>
                    <Text style={styles.subscreenTitle}>Bulk</Text>
                    <Text style={styles.subscreenSubtitle}>Génération en lot</Text>
                  </View>
                </View>
                <Bulk
                  active={bulkActive && libraryAvailable}
                  disabled={busy}
                  library={library}
                  onBusyChange={onBusyChange}
                  onRefresh={refreshLibrary}
                  refreshing={isRefreshing}
                />
              </>
            ) : null}
          </ScreenSlot>

          {mediaScreenActive && isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={styles.loadingTitle}>Chargement de ta médiathèque</Text>
              <Text style={styles.loadingSubtitle}>Hooks, captures, musiques et textes</Text>
            </View>
          ) : null}

          {mediaScreenActive && !isLoading && loadError && libraryCount === 0 ? (
            <View style={styles.errorCard}>
              <View style={styles.errorIcon}>
                <Ionicons color={colors.danger} name="cloud-offline-outline" size={26} />
              </View>
              <Text style={styles.errorTitle}>Connexion impossible</Text>
              <Text style={styles.errorText}>{loadError}</Text>
              <View style={styles.retry}>
                <PrimaryButton
                  compact
                  icon="refresh"
                  label="Réessayer"
                  onPress={() => void refresh()}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setSettingsRoute('home');
                  setTab('settings');
                }}
                style={({ pressed }) => [styles.settingsShortcut, pressed && styles.pressed]}
              >
                <Ionicons color={colors.textMuted} name="settings-outline" size={17} />
                <Text style={styles.settingsShortcutText}>Vérifier l’adresse Cloudflare</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>

      <View
        pointerEvents="box-none"
        style={[styles.tabs, { bottom: tabBottom }]}
      >
        <TabBar onChange={handleTabChange} value={tab} />
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navigationTheme}>
        <ScaylitApp />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  tabs: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 20,
  },
  body: {
    flex: 1,
  },
  warning: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: '#51481A',
    borderRadius: radii.sm,
    backgroundColor: '#211E0C',
  },
  warningText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  screens: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  hiddenScreen: {
    display: 'none',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  loadingTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    marginTop: spacing.lg,
  },
  loadingSubtitle: {
    color: colors.textFaint,
    fontSize: 12,
    marginTop: 5,
  },
  errorCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 34,
  },
  errorIcon: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 29,
    backgroundColor: colors.dangerSoft,
  },
  errorTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: '800',
    marginTop: spacing.lg,
  },
  errorText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  retry: {
    width: '100%',
    maxWidth: 260,
    marginTop: spacing.xl,
  },
  settingsShortcut: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  settingsShortcutText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  subscreenHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  subscreenTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.35,
  },
  subscreenSubtitle: {
    color: colors.textFaint,
    fontSize: 10,
    marginTop: 1,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
});
