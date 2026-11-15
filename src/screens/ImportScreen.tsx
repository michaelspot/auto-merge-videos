import { useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';

import { addText, uploadMedia, type UploadMediaAsset } from '../api';
import { discardPickedMedia, pickLibraryMedia, pickLibraryMediaList } from '../mediaPicker';
import { colors, radii, spacing } from '../theme';
import type { MediaKind, MediaLibrary } from '../types';
import { errorMessage, uniqueTags } from '../utils';
import { PrimaryButton } from '../components/Button';
import { SectionHeader } from '../components/Section';
import { TagChips } from '../components/Tags';

interface ImportScreenProps {
  library: MediaLibrary;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  onNavigateMontage: () => void;
  onNavigateHiggsfield: () => void;
  disabled: boolean;
}

type ImportBusy = MediaKind | 'texte' | null;

const MAX_VIDEOS_PER_IMPORT = 10;

function megabytes(bytes: number) {
  return Math.max(0, Math.round(bytes / 1_000_000)).toLocaleString('fr-FR');
}

interface UploadBlockProps {
  title: string;
  description: string;
  pickerLabel: string;
  pickerSubtitle: string;
  tags: string[];
  value: string;
  busy: boolean;
  status?: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onPick: () => void;
}

function UploadBlock({
  title,
  description,
  pickerLabel,
  pickerSubtitle,
  tags,
  value,
  busy,
  status,
  disabled,
  onChange,
  onPick,
}: UploadBlockProps) {
  const selected = new Set(value.trim() ? [value.trim()] : []);
  return (
    <View style={styles.block}>
      <SectionHeader title={title} />
      <Text style={styles.description}>{description}</Text>
      {tags.length > 0 ? (
        <View style={styles.suggestions}>
          <TagChips
            disabled={disabled}
            onToggle={(tag) => onChange(value.trim() === tag ? '' : tag)}
            selected={selected}
            tags={tags}
          />
        </View>
      ) : null}
      <TextInput
        autoCapitalize="none"
        editable={!disabled}
        maxLength={64}
        onChangeText={onChange}
        placeholder="Tag (optionnel)"
        placeholderTextColor={colors.textFaint}
        returnKeyType="done"
        style={styles.input}
        value={value}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityHint={busy ? 'Annule l’import en cours' : undefined}
        disabled={disabled && !busy}
        onPress={onPick}
        style={({ pressed }) => [
          styles.picker,
          disabled && !busy && styles.disabled,
          pressed && (!disabled || busy) && styles.pressed,
        ]}
      >
        <View style={styles.pickerIcon}>
          <Ionicons color={colors.accent} name={busy ? 'hourglass-outline' : 'add'} size={25} />
        </View>
        <View style={styles.pickerCopy}>
          <Text numberOfLines={1} style={styles.pickerTitle}>
            {busy ? status || 'Import en cours…' : pickerLabel}
          </Text>
          <Text style={styles.pickerSubtitle}>{busy ? 'Touche pour annuler' : pickerSubtitle}</Text>
        </View>
        <Ionicons color={colors.textFaint} name={busy ? 'close' : 'chevron-forward'} size={18} />
      </Pressable>
    </View>
  );
}

export function ImportScreen({
  library,
  refreshing,
  onRefresh,
  onBusyChange,
  onNavigateMontage,
  onNavigateHiggsfield,
  disabled: externallyDisabled,
}: ImportScreenProps) {
  const [tags, setTags] = useState<Record<MediaKind | 'texte', string>>({
    hook: '',
    capture: '',
    musique: '',
    influ: '',
    texte: '',
  });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<ImportBusy>(null);
  const [status, setStatus] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const setTag = (key: MediaKind | 'texte', value: string) => {
    setTags((current) => ({ ...current, [key]: value }));
  };

  const pickAudioFile = async (): Promise<UploadMediaAsset | null> => {
    const selection = await DocumentPicker.getDocumentAsync({
      type: 'audio/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (selection.canceled) return null;
    return selection.assets[0] ?? null;
  };

  const confirmCancel = () => {
    const controller = abortRef.current;
    if (!controller || controller.signal.aborted) return;
    Alert.alert('Annuler l’import ?', 'Les fichiers déjà envoyés restent dans Scaylit.', [
      { text: 'Continuer', style: 'cancel' },
      { text: 'Annuler l’import', style: 'destructive', onPress: () => controller.abort() },
    ]);
  };

  const pickAssets = async (type: MediaKind): Promise<UploadMediaAsset[]> => {
    if (type === 'musique') {
      const audio = await pickAudioFile();
      return audio ? [audio] : [];
    }
    if (type === 'influ') {
      const image = await pickLibraryMedia('image');
      return image ? [image] : [];
    }
    return pickLibraryMediaList('video', MAX_VIDEOS_PER_IMPORT);
  };

  const handlePick = async (type: MediaKind) => {
    if (busy !== null) {
      if (busy === type) confirmCancel();
      return;
    }
    if (externallyDisabled) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(type);
    setStatus('Préparation…');
    onBusyChange(true);

    let assets: UploadMediaAsset[] = [];
    let uploaded = 0;
    let failure: string | null = null;
    try {
      assets = await pickAssets(type);
      const tag = tags[type].trim() || undefined;

      for (const [index, asset] of assets.entries()) {
        if (controller.signal.aborted) break;
        const prefix = assets.length > 1 ? `${index + 1}/${assets.length} · ` : '';
        let lastPercent = -1;
        setStatus(`${prefix}Envoi…`);
        await uploadMedia(asset, type, tag, {
          signal: controller.signal,
          onProgress: (sent, total) => {
            if (total <= 0) return;
            const percent = Math.min(100, Math.floor((sent / total) * 100));
            if (percent === lastPercent) return;
            lastPercent = percent;
            setStatus(`${prefix}Envoi ${percent} % · ${megabytes(sent)}/${megabytes(total)} Mo`);
          },
        });
        uploaded += 1;
      }
    } catch (error) {
      if (!controller.signal.aborted) failure = errorMessage(error);
    } finally {
      // uploadMedia supprime chaque copie envoyée ; on nettoie celles qui restent (erreur/annulation).
      discardPickedMedia(assets.slice(uploaded));
    }

    try {
      if (uploaded > 0) {
        setStatus('Mise à jour de la médiathèque…');
        await onRefresh();
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTag(type, '');
      }

      if (failure) {
        Alert.alert(
          'Import impossible',
          uploaded > 0 ? `${uploaded}/${assets.length} fichier(s) importé(s). ${failure}` : failure,
        );
      } else if (uploaded > 0 && !controller.signal.aborted) {
        if (type === 'hook' || type === 'capture') onNavigateMontage();
        else if (type === 'influ') onNavigateHiggsfield();
        else Alert.alert('Import terminé', `${assets[0]?.name ?? 'Le fichier'} est prêt dans Scaylit.`);
      }
    } finally {
      abortRef.current = null;
      setBusy(null);
      setStatus('');
      onBusyChange(false);
    }
  };

  const handleAddText = async () => {
    if (externallyDisabled || busy !== null) return;
    const cleanText = text.trim();
    if (!cleanText) {
      Alert.alert('Texte manquant', 'Saisis le texte à utiliser dans les montages Bulk.');
      return;
    }

    setBusy('texte');
    onBusyChange(true);
    try {
      await addText(cleanText, tags.texte.trim() || undefined);
      setText('');
      setTag('texte', '');
      await onRefresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Texte ajouté', 'Il est maintenant disponible dans Bulk.');
    } catch (error) {
      Alert.alert('Ajout impossible', errorMessage(error));
    } finally {
      setBusy(null);
      onBusyChange(false);
    }
  };

  const disabled = externallyDisabled || busy !== null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={116}
      style={styles.screen}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
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
        <UploadBlock
          busy={busy === 'influ'}
          status={status}
          description="La personne de référence à utiliser dans tes vidéos Higgsfield."
          disabled={disabled}
          onChange={(value) => setTag('influ', value)}
          onPick={() => void handlePick('influ')}
          pickerLabel="Choisir une photo"
          pickerSubtitle="Retrouve tes images dans le carrousel Influ"
          tags={uniqueTags(library.influs)}
          title="Importer une influ"
          value={tags.influ}
        />
        <UploadBlock
          busy={busy === 'hook'}
          status={status}
          description="La première séquence qui arrête le scroll."
          disabled={disabled}
          onChange={(value) => setTag('hook', value)}
          onPick={() => void handlePick('hook')}
          pickerLabel="Choisir dans Photos"
          pickerSubtitle="Une ou plusieurs vidéos de la photothèque"
          tags={uniqueTags(library.hooks)}
          title="Importer un hook"
          value={tags.hook}
        />
        <UploadBlock
          busy={busy === 'capture'}
          status={status}
          description="La démonstration ou capture qui suit le hook."
          disabled={disabled}
          onChange={(value) => setTag('capture', value)}
          onPick={() => void handlePick('capture')}
          pickerLabel="Choisir dans Photos"
          pickerSubtitle="Une ou plusieurs vidéos de la photothèque"
          tags={uniqueTags(library.captures)}
          title="Importer un screen recording"
          value={tags.capture}
        />
        <UploadBlock
          busy={busy === 'musique'}
          status={status}
          description="Une bande-son choisie aléatoirement dans les lots."
          disabled={disabled}
          onChange={(value) => setTag('musique', value)}
          onPick={() => void handlePick('musique')}
          pickerLabel="Choisir un fichier audio"
          pickerSubtitle="Fichiers audio uniquement"
          tags={uniqueTags(library.musiques)}
          title="Importer une musique"
          value={tags.musique}
        />

        <View style={styles.block}>
          <SectionHeader title="Ajouter un texte" />
          <Text style={styles.description}>Jusqu’à trois lignes dans la safe zone TikTok.</Text>
          {library.textes.length > 0 ? (
            <View style={styles.suggestions}>
              <TagChips
                disabled={disabled}
                onToggle={(tag) => setTag('texte', tags.texte.trim() === tag ? '' : tag)}
                selected={new Set(tags.texte.trim() ? [tags.texte.trim()] : [])}
                tags={uniqueTags(library.textes)}
              />
            </View>
          ) : null}
          <TextInput
            autoCapitalize="none"
            editable={!disabled}
            maxLength={64}
            onChangeText={(value) => setTag('texte', value)}
            placeholder="Tag (optionnel)"
            placeholderTextColor={colors.textFaint}
            returnKeyType="next"
            style={styles.input}
            value={tags.texte}
          />
          <TextInput
            editable={!disabled}
            maxLength={500}
            multiline
            onChangeText={setText}
            placeholder="Saisir le texte…"
            placeholderTextColor={colors.textFaint}
            style={[styles.input, styles.textarea]}
            textAlignVertical="top"
            value={text}
          />
          <PrimaryButton
            compact
            disabled={disabled || !text.trim()}
            icon="text"
            label={busy === 'texte' ? 'Ajout…' : 'Ajouter le texte'}
            loading={busy === 'texte'}
            onPress={() => void handleAddText()}
          />
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
    gap: 48,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: 64,
  },
  block: {
    minWidth: 0,
  },
  description: {
    color: colors.textFaint,
    fontSize: 12,
    lineHeight: 17,
    marginTop: -5,
    marginBottom: spacing.md,
  },
  suggestions: {
    marginBottom: spacing.md,
  },
  input: {
    minHeight: 46,
    color: colors.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  textarea: {
    minHeight: 104,
    paddingTop: spacing.md,
  },
  picker: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
  },
  pickerIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: '#1E2400',
  },
  pickerCopy: {
    flex: 1,
  },
  pickerTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  pickerSubtitle: {
    color: colors.textFaint,
    fontSize: 11,
    marginTop: 4,
  },
  disabled: {
    opacity: 0.42,
  },
  pressed: {
    opacity: 0.7,
  },
});
