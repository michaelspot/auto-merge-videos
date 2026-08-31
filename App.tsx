import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { setAudioModeAsync } from 'expo-audio';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from './src/components/Button';
import { TabBar } from './src/components/TabBar';
import { useMediaLibrary } from './src/hooks/useMediaLibrary';
import { BulkScreen } from './src/screens/BulkScreen';
import { ImportScreen } from './src/screens/ImportScreen';
import { MontageScreen } from './src/screens/MontageScreen';
import { colors, radii, spacing } from './src/theme';
import type { AppTab } from './src/types';
import { useCallback, useEffect, useState } from 'react';

function ScaylitApp() {
  const [tab, setTab] = useState<AppTab>('montage');
  const [busyOperations, setBusyOperations] = useState(0);
  const { library, isLoading, isRefreshing, loadError, refresh } = useMediaLibrary();
  const refreshLibrary = () => refresh(true);
  const onBusyChange = useCallback((nextBusy: boolean) => {
    setBusyOperations((current) => Math.max(0, current + (nextBusy ? 1 : -1)));
  }, []);
  const busy = busyOperations > 0;
  const libraryCount =
    library.hooks.length + library.captures.length + library.musiques.length + library.textes.length;

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
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.brand}>
          <Image source={require('./assets/icon.png')} style={styles.logo} />
          <View>
            <Text style={styles.brandName}>Scaylit</Text>
            <Text style={styles.brandTagline}>Create once. Scale everything.</Text>
          </View>
        </View>
        <Pressable
          accessibilityLabel="Actualiser la médiathèque"
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || isRefreshing, busy: isRefreshing }}
          disabled={busy || isRefreshing}
          hitSlop={8}
          onPress={() => void refreshLibrary()}
          style={({ pressed }) => [
            styles.refresh,
            (busy || isRefreshing) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          {isRefreshing ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <Ionicons color={colors.textMuted} name="refresh" size={18} />
          )}
        </Pressable>
      </View>
      <View style={styles.tabs}>
        <TabBar disabled={busy} onChange={setTab} value={tab} />
      </View>
      {loadError && libraryCount > 0 ? (
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

      <View style={styles.body}>
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={styles.loadingTitle}>Chargement de ta médiathèque</Text>
            <Text style={styles.loadingSubtitle}>Hooks, captures, musiques et textes</Text>
          </View>
        ) : loadError && libraryCount === 0 ? (
          <View style={styles.errorCard}>
            <View style={styles.errorIcon}>
              <Ionicons color={colors.danger} name="cloud-offline-outline" size={26} />
            </View>
            <Text style={styles.errorTitle}>Connexion impossible</Text>
            <Text style={styles.errorText}>{loadError}</Text>
            <View style={styles.retry}>
              <PrimaryButton compact icon="refresh" label="Réessayer" onPress={() => void refresh()} />
            </View>
          </View>
        ) : (
          <View style={styles.screens}>
            <View
              accessibilityElementsHidden={tab !== 'montage'}
              importantForAccessibility={tab === 'montage' ? 'auto' : 'no-hide-descendants'}
              pointerEvents={tab === 'montage' ? 'auto' : 'none'}
              style={[styles.screen, tab !== 'montage' && styles.hiddenScreen]}
            >
              <MontageScreen
                active={tab === 'montage'}
                disabled={busy}
                library={library}
                onBusyChange={onBusyChange}
                onRefresh={refreshLibrary}
                refreshing={isRefreshing}
              />
            </View>
            <View
              accessibilityElementsHidden={tab !== 'import'}
              importantForAccessibility={tab === 'import' ? 'auto' : 'no-hide-descendants'}
              pointerEvents={tab === 'import' ? 'auto' : 'none'}
              style={[styles.screen, tab !== 'import' && styles.hiddenScreen]}
            >
              <ImportScreen
                disabled={busy}
                library={library}
                onBusyChange={onBusyChange}
                onNavigateMontage={() => setTab('montage')}
                onRefresh={refreshLibrary}
                refreshing={isRefreshing}
              />
            </View>
            <View
              accessibilityElementsHidden={tab !== 'bulk'}
              importantForAccessibility={tab === 'bulk' ? 'auto' : 'no-hide-descendants'}
              pointerEvents={tab === 'bulk' ? 'auto' : 'none'}
              style={[styles.screen, tab !== 'bulk' && styles.hiddenScreen]}
            >
              <BulkScreen
                active={tab === 'bulk'}
                disabled={busy}
                library={library}
                onBusyChange={onBusyChange}
                onRefresh={refreshLibrary}
                refreshing={isRefreshing}
              />
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ScaylitApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  logo: {
    width: 38,
    height: 38,
    borderRadius: 10,
  },
  brandName: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  brandTagline: {
    color: colors.textFaint,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginTop: 1,
  },
  refresh: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  tabs: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
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
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
});
