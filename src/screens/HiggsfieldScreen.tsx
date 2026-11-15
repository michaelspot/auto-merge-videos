import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '../components/Button';
import { VideoPreview } from '../components/VideoPreview';
import { ResultCard } from '../components/ResultCard';
import { useHiggsfield } from '../hooks/useHiggsfield';
import { getHiggsfieldVideoResult } from '../higgsfieldMedia';
import {
  DEFAULT_HIGGSFIELD_PROMPT, HIGGSFIELD_DURATIONS, HIGGSFIELD_FORMATS, HIGGSFIELD_MODELS,
  higgsfieldCreditLabel, type HiggsfieldFormat, type HiggsfieldModelId,
} from '../higgsfield';
import { pickLibraryMedia, type PickedVideo } from '../mediaPicker';
import { colors, radii, spacing } from '../theme';
import type { MediaItem } from '../types';
import { errorMessage } from '../utils';

interface HiggsfieldScreenProps {
  active: boolean;
  video: PickedVideo | null;
  onVideoChange: (video: PickedVideo | null) => void;
  influs: MediaItem[];
  libraryError: string | null;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onImport: () => void;
}

type SelectionSheet = 'model' | 'format' | 'duration' | 'account' | null;

function SettingRow({ label, value, icon, disabled, onPress }: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      accessibilityHint={`Modifier ${label.toLowerCase()}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.setting, pressed && styles.pressed]}
    >
      <Ionicons color={colors.textMuted} name={icon} size={21} />
      <View style={styles.flex}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingValue}>{value}</Text>
      </View>
      <Ionicons color={colors.textFaint} name="chevron-forward" size={18} />
    </Pressable>
  );
}

export function HiggsfieldScreen({
  active, video, onVideoChange, influs, libraryError, refreshing, onRefresh, onImport,
}: HiggsfieldScreenProps) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [picking, setPicking] = useState(false);
  const pickInFlight = useRef(false);
  const [prompt, setPrompt] = useState(DEFAULT_HIGGSFIELD_PROMPT);
  const [influId, setInfluId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<HiggsfieldModelId>('seedance_2_5');
  const [format, setFormat] = useState<HiggsfieldFormat>('9:16');
  const [duration, setDuration] = useState<number>(7);
  const [sheet, setSheet] = useState<SelectionSheet>(null);
  const selectedInflu = influs.find(item => item.public_id === influId) ?? influs[0] ?? null;
  const higgsfield = useHiggsfield({ active, modelId, prompt, format, duration, video, influUrl: selectedInflu?.url });
  const disabled = picking || higgsfield.submitting || higgsfield.pending || higgsfield.connecting || higgsfield.loading;
  const model = higgsfield.model;
  const result = getHiggsfieldVideoResult(higgsfield.job);
  const formats = model ? HIGGSFIELD_FORMATS.filter(item => model.formats.includes(item.id)) : HIGGSFIELD_FORMATS;
  const durations: readonly number[] = model?.durations ?? HIGGSFIELD_DURATIONS;

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [video?.uri]);

  useEffect(() => {
    if (!model) return;
    if (model.id !== modelId) setModelId(model.id);
    if (!model.formats.includes(format)) setFormat((model.formats.includes('9:16') ? '9:16' : model.formats[0]!) as HiggsfieldFormat);
    if (!model.durations.includes(duration)) setDuration(model.durations.reduce((best, value) => Math.abs(value - duration) < Math.abs(best - duration) ? value : best));
  }, [model, modelId, format, duration]);

  const openHiggsfield = () => {
    void Linking.openURL('https://higgsfield.ai').catch(() => Alert.alert('Ouverture impossible', 'Ouvre higgsfield.ai dans Safari.'));
  };

  const refreshAll = async () => {
    await Promise.all([onRefresh(), ...(higgsfield.connected ? [higgsfield.refresh()] : [])]);
  };

  const pickVideo = async () => {
    if (disabled || pickInFlight.current) return;
    pickInFlight.current = true;
    setPicking(true);
    try {
      const asset = await pickLibraryMedia('video');
      if (asset) onVideoChange(asset);
    } catch (error) {
      Alert.alert('Import impossible', errorMessage(error));
    } finally {
      pickInFlight.current = false;
      setPicking(false);
    }
  };

  const options = sheet === 'model' ? (higgsfield.models.length ? higgsfield.models : HIGGSFIELD_MODELS)
    : sheet === 'format' ? formats
    : durations.map(seconds => ({ id: String(seconds), name: `${seconds} secondes`, detail: '' }));
  const selectedOption = sheet === 'model' ? modelId : sheet === 'format' ? format : String(duration);
  const sheetTitle = sheet === 'account' ? 'Compte Higgsfield' : sheet === 'model' ? 'Modèle' : sheet === 'format' ? 'Format' : 'Nombre de secondes';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing || higgsfield.loading} enabled={!disabled} tintColor={colors.accent}
          onRefresh={() => { if (!disabled) void refreshAll(); }} />}
      >
        <View style={styles.header}>
          <View style={styles.brandIcon}><Ionicons color={colors.accent} name="sparkles" size={22} /></View>
          <Text accessibilityRole="header" style={styles.title}>Higgsfield</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={higgsfield.connected ? 'Compte et crédits Higgsfield' : 'Connecter mon compte Higgsfield'}
            disabled={disabled || higgsfield.loading} onPress={() => {
              if (higgsfield.connected) setSheet('account');
              else void higgsfield.connect();
            }} style={styles.accountButton}>
            {higgsfield.connecting || higgsfield.loading ? <ActivityIndicator size="small" color={colors.accent} /> :
              <Text style={styles.accountText}>{higgsfield.connected ? (higgsfield.balance === null ? 'Compte' : `${higgsfieldCreditLabel(higgsfield.balance)} ◇`) : 'Connecter'}</Text>}
          </Pressable>
        </View>

        {higgsfield.error ? <View style={styles.messageBox}>
          <Text accessibilityRole="alert" style={styles.error}>{higgsfield.error}</Text>
          {!higgsfield.pending && !higgsfield.uncertain ? <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void higgsfield.connect()} style={styles.inlineAction}>
            <Text style={styles.link}>Reconnecter Higgsfield</Text>
          </Pressable> : null}
        </View> : null}

        <View style={styles.section}>
          <Text style={styles.label}>Vidéo</Text>
          {video ? (
            <View style={styles.videoCard}>
              <View style={styles.preview}>
                <VideoPreview url={video.uri} active={active} controls />
              </View>
              <View style={[styles.flex, styles.videoCopy]}>
                <Text numberOfLines={2} style={styles.fileName}>{video.name}</Text>
                {video.durationSeconds !== null ? <Text style={styles.caption}>{video.durationSeconds.toFixed(1).replace('.', ',')} s · vidéo source</Text> : null}
                <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void pickVideo()} style={styles.inlineAction}>
                  <Ionicons color={colors.accent} name="swap-horizontal" size={17} />
                  <Text style={styles.link}>Changer</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={disabled} onPress={() => onVideoChange(null)} style={styles.inlineAction}>
                  <Text style={styles.caption}>Retirer la vidéo</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel="Importer la vidéo depuis Photos"
              accessibilityState={{ disabled, busy: picking }} disabled={disabled}
              onPress={() => void pickVideo()} style={({ pressed }) => [styles.videoPicker, pressed && styles.pressed]}>
              <View style={styles.uploadIcon}>
                {picking ? <ActivityIndicator color={colors.accent} /> : <Ionicons color={colors.accent} name="add" size={27} />}
              </View>
              <Text style={styles.pickerTitle}>{picking ? 'Ouverture de Photos…' : 'Importer une vidéo'}</Text>
              <Text style={styles.caption}>Directement depuis Photos</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.promptCard}>
          <View style={styles.row}>
            <Text style={styles.label}>Prompt</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Rétablir le prompt préfait"
              disabled={disabled || prompt === DEFAULT_HIGGSFIELD_PROMPT}
              onPress={() => setPrompt(DEFAULT_HIGGSFIELD_PROMPT)} style={styles.reset}>
              <Ionicons color={colors.textMuted} name="refresh" size={15} />
              <Text style={styles.caption}>Préfait</Text>
            </Pressable>
          </View>
          <TextInput accessibilityLabel="Prompt Higgsfield" editable={!disabled} multiline maxLength={4000}
            onChangeText={setPrompt} placeholder="Décris la vidéo souhaitée…" placeholderTextColor={colors.textFaint}
            style={styles.prompt} textAlignVertical="top" value={prompt} />
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={styles.label}>Influ</Text>
            <Text style={styles.caption}>{influs.length} référence{influs.length === 1 ? '' : 's'}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
            <Pressable accessibilityRole="button" accessibilityLabel="Importer une image Influ" disabled={disabled}
              onPress={onImport} style={({ pressed }) => [styles.addInflu, pressed && styles.pressed]}>
              <Ionicons color={colors.textMuted} name="add" size={27} />
              <Text style={styles.caption}>Importer</Text>
            </Pressable>
            {influs.map((influ, index) => {
              const selected = influ.public_id === selectedInflu?.public_id;
              return (
                <Pressable accessibilityRole="radio" accessibilityLabel={`Influ ${index + 1}, ${influ.name}`}
                  accessibilityState={{ selected, checked: selected, disabled }} disabled={disabled} key={influ.public_id}
                  onPress={() => { setInfluId(influ.public_id); void Haptics.selectionAsync().catch(() => undefined); }}
                  style={({ pressed }) => [styles.influ, selected && styles.selectedInflu, pressed && styles.pressed]}>
                  <Image source={influ.url} contentFit="cover" style={styles.influImage} />
                  {selected ? <View style={styles.check}><Ionicons color={colors.accentInk} name="checkmark" size={14} /></View> : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <Text style={styles.caption}>{selectedInflu ? 'La personne de cette photo remplacera celle de la vidéo.' : 'Ajoute la photo de la personne à utiliser depuis Importer.'}</Text>
          {libraryError ? <Text accessibilityRole="alert" style={styles.error}>Les références n’ont pas pu être actualisées. Tire vers le bas pour réessayer.</Text> : null}
        </View>

        <View style={styles.settings}>
          <SettingRow label="Modèle" value={model?.name ?? HIGGSFIELD_MODELS.find(item => item.id === modelId)?.name ?? 'Seedance 2.5'} icon="sparkles-outline" disabled={disabled} onPress={() => setSheet('model')} />
          <View style={styles.divider} />
          <SettingRow label="Format" value={format} icon="crop-outline" disabled={disabled} onPress={() => setSheet('format')} />
          <View style={styles.divider} />
          <SettingRow label="Nombre de secondes" value={`${duration} secondes`} icon="time-outline" disabled={disabled} onPress={() => setSheet('duration')} />
        </View>

        <View style={styles.footer}>
          <View style={styles.row}>
            <Text style={styles.caption}>Coût de la vidéo</Text>
            <View style={styles.creditValue}>
              {higgsfield.quoting ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons color={colors.accent} name="diamond-outline" size={16} />}
              <Text style={styles.credits}>{higgsfield.quote ? higgsfieldCreditLabel(higgsfield.quote.credits) : '—'} crédits</Text>
            </View>
          </View>
          <Text style={styles.costHint}>{!higgsfield.connected ? 'Connecte ton compte pour utiliser tes crédits Higgsfield.'
            : higgsfield.quoting ? 'Envoi des références et calcul du coût…'
            : higgsfield.quote ? `${model?.detail ? `${model.detail} · ` : ''}Coût confirmé par Higgsfield pour 1 vidéo.`
            : !video || !selectedInflu ? 'Importe une vidéo et choisis une Influ pour connaître le coût.' : 'Le coût sera vérifié avant toute génération.'}</Text>
          {higgsfield.quoteError ? <View>
            <Text accessibilityRole="alert" style={styles.error}>{higgsfield.quoteError}</Text>
            <Pressable accessibilityRole="button" disabled={disabled || higgsfield.quoting} onPress={higgsfield.retryQuote} style={styles.inlineAction}>
              <Text style={styles.link}>Recalculer le coût</Text>
            </Pressable>
          </View> : null}
          <PrimaryButton disabled={disabled || !higgsfield.quote || higgsfield.quoting || higgsfield.uncertain ||
            (higgsfield.balance !== null && !!higgsfield.quote && higgsfield.balance < higgsfield.quote.credits)}
            loading={higgsfield.submitting} icon="sparkles"
            label={higgsfield.pending ? 'Génération en cours…' : higgsfield.quote ? `Générer · ${higgsfieldCreditLabel(higgsfield.quote.credits)} crédits` : 'Générer'}
            onPress={() => void higgsfield.generate()} />
          {higgsfield.quote && higgsfield.balance !== null && higgsfield.balance < higgsfield.quote.credits ?
            <Text style={styles.error}>Solde Higgsfield insuffisant.</Text> : null}
          {higgsfield.pending ? <View style={styles.progressBox}>
            <ActivityIndicator color={colors.accent} />
            <View style={styles.flex}>
              <Text style={styles.fileName}>{['pending', 'waiting', 'queued'].includes(higgsfield.job!.status) ? 'En attente chez Higgsfield' : 'Higgsfield crée ta vidéo'}</Text>
              <Text style={styles.caption}>Tu peux changer d’onglet. Le suivi reprendra à ton retour.</Text>
            </View>
          </View> : null}
          {higgsfield.uncertain ? <View style={styles.messageBox}>
            <Text style={styles.caption}>La demande a peut-être été reçue. Vérifie tes générations pour éviter de payer deux fois.</Text>
            <Pressable accessibilityRole="button" onPress={openHiggsfield} style={styles.inlineAction}><Text style={styles.link}>Vérifier sur Higgsfield</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => Alert.alert('Vérification des générations',
              'Confirme que la vidéo n’existe pas déjà dans ton compte avant d’autoriser un nouvel envoi.',
              [{ text: 'Retour', style: 'cancel' }, { text: 'J’ai vérifié', onPress: higgsfield.clearJob }])} style={styles.inlineAction}>
              <Text style={styles.caption}>J’ai vérifié mes vidéos</Text>
            </Pressable>
          </View> : null}
          {higgsfield.job && !higgsfield.pending && !result ? <View style={styles.messageBox}>
            <Text style={styles.caption}>{higgsfield.job.status === 'ip_detected' ? 'Higgsfield demande de vérifier les droits sur cette vidéo dans ton compte.'
              : higgsfield.job.status === 'nsfw' ? 'Higgsfield a refusé cette génération.'
              : higgsfield.job.status === 'canceled' ? 'La génération a été annulée.'
              : higgsfield.job.status === 'completed' ? 'La génération est terminée. Retrouve la vidéo dans ton compte Higgsfield.' : 'La génération a échoué chez Higgsfield.'}</Text>
            <Pressable accessibilityRole="button" onPress={openHiggsfield} style={styles.inlineAction}><Text style={styles.link}>Ouvrir Higgsfield</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={higgsfield.clearJob} style={styles.inlineAction}><Text style={styles.caption}>Nouvelle vidéo</Text></Pressable>
          </View> : null}
          {result ? <ResultCard result={result} active={active} /> : null}
        </View>
      </ScrollView>

      <Modal animationType="slide" transparent visible={active && sheet !== null} onRequestClose={() => setSheet(null)}>
        <View style={styles.modalOverlay}>
          <Pressable accessibilityRole="button" accessibilityLabel="Fermer la sélection" onPress={() => setSheet(null)} style={StyleSheet.absoluteFill} />
          <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <Text accessibilityRole="header" style={styles.sheetTitle}>{sheetTitle}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Fermer" onPress={() => setSheet(null)} style={styles.close}>
                <Ionicons color={colors.textMuted} name="close" size={22} />
              </Pressable>
            </View>
            {sheet === 'account' ? <View style={styles.accountContent}>
              <Text style={styles.optionName}>{higgsfield.workspace?.name ?? 'Mon compte personnel'}</Text>
              <Text style={styles.credits}>{higgsfield.balance === null ? '—' : higgsfieldCreditLabel(higgsfield.balance)} crédits disponibles</Text>
              <Text style={styles.caption}>Tes générations utilisent directement ce solde Higgsfield.</Text>
              <Pressable accessibilityRole="button" disabled={disabled} onPress={() => { setSheet(null); void higgsfield.connect(); }} style={styles.inlineAction}><Text style={styles.link}>Reconnecter le compte</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={disabled} onPress={() => { setSheet(null); void higgsfield.disconnect(); }} style={styles.inlineAction}><Text style={styles.caption}>Se déconnecter</Text></Pressable>
            </View> : <ScrollView showsVerticalScrollIndicator={false}>
              {options.map(option => (
                <Pressable accessibilityRole="radio" accessibilityState={{ checked: option.id === selectedOption, selected: option.id === selectedOption }}
                  key={option.id} onPress={() => {
                    if (sheet === 'model') setModelId(option.id as HiggsfieldModelId);
                    else if (sheet === 'format') setFormat(option.id as HiggsfieldFormat);
                    else setDuration(Number(option.id));
                    void Haptics.selectionAsync().catch(() => undefined);
                    setSheet(null);
                  }} style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
                  <View style={styles.flex}>
                    <Text style={styles.optionName}>{option.name}</Text>
                    {option.detail ? <Text style={styles.caption}>{option.detail}</Text> : null}
                  </View>
                  {option.id === selectedOption ? <Ionicons color={colors.accent} name="checkmark-circle" size={24} /> : null}
                </Pressable>
              ))}
            </ScrollView>}
            {sheet === 'model' ? <Text style={styles.sheetNote}>{higgsfield.connected ? 'Modèles compatibles avec une vidéo et une photo de référence.' : 'Connecte ton compte pour charger les modèles disponibles.'}</Text> : null}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 4 },
  brandIcon: { width: 38, height: 38, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: '#202600' },
  title: { flex: 1, color: colors.text, fontSize: 25, fontWeight: '800', letterSpacing: -0.8 },
  accountButton: { minHeight: 44, minWidth: 70, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised },
  accountText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  accountContent: { gap: spacing.md, paddingBottom: spacing.lg },
  messageBox: { padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceRaised, gap: 4 },
  progressBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radii.md, backgroundColor: colors.surfaceRaised },
  section: { gap: spacing.md },
  label: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  videoPicker: { minHeight: 160, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong, borderRadius: radii.lg, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 6, padding: spacing.lg },
  uploadIcon: { width: 44, height: 44, backgroundColor: colors.surfaceSoft, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  pickerTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  videoCard: { flexDirection: 'row', gap: spacing.lg, padding: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg },
  preview: { height: 176, width: 99, borderRadius: radii.md, overflow: 'hidden' },
  videoCopy: { justifyContent: 'center', gap: 5 },
  fileName: { color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  inlineAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6 },
  link: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  promptCard: { padding: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  reset: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, marginVertical: -10, paddingLeft: 10 },
  prompt: { color: colors.text, fontSize: 15, lineHeight: 23, minHeight: 142, padding: 0, paddingTop: 12 },
  carousel: { gap: 10, paddingVertical: 2 },
  addInflu: { width: 86, height: 100, alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong, borderRadius: radii.lg, backgroundColor: colors.surface },
  influ: { width: 86, height: 100, borderRadius: radii.lg, borderWidth: 2, borderColor: colors.border, padding: 3, backgroundColor: colors.surface },
  selectedInflu: { borderColor: colors.accent },
  influImage: { flex: 1, borderRadius: 12 },
  check: { position: 'absolute', bottom: 7, right: 7, width: 22, height: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderRadius: 11 },
  settings: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden' },
  setting: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: spacing.lg, paddingVertical: 15, minHeight: 76 },
  settingLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 5 },
  settingValue: { color: colors.text, fontSize: 17, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 51 },
  footer: { gap: spacing.md },
  creditValue: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  credits: { color: colors.accent, fontSize: 17, fontWeight: '700' },
  costHint: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: -5 },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  pressed: { opacity: 0.65 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: { maxHeight: '80%', borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.surfaceRaised, paddingHorizontal: spacing.xl },
  handle: { width: 36, height: 5, backgroundColor: colors.borderStrong, borderRadius: radii.pill, alignSelf: 'center', marginTop: 10 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  sheetTitle: { color: colors.text, fontSize: 21, fontWeight: '700' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  option: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  optionName: { color: colors.text, fontSize: 17, marginBottom: 2 },
  sheetNote: { color: colors.textMuted, fontSize: 12, lineHeight: 18, paddingTop: 14 },
});
