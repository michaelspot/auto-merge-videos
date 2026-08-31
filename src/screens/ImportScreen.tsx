import { useState } from 'react';
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

import { addText, uploadMedia } from '../api';
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
  disabled: boolean;
}

type ImportBusy = MediaKind | 'texte' | null;

interface UploadBlockProps {
  title: string;
  description: string;
  type: MediaKind;
  tags: string[];
  value: string;
  busy: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onPick: () => void;
}

function UploadBlock({
  title,
  description,
  tags,
  value,
  busy,
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
        disabled={disabled}
        onPress={onPick}
        style={({ pressed }) => [
          styles.picker,
          disabled && styles.disabled,
          pressed && !disabled && styles.pressed,
        ]}
      >
        <View style={styles.pickerIcon}>
          <Ionicons color={colors.accent} name={busy ? 'hourglass-outline' : 'add'} size={25} />
        </View>
        <View style={styles.pickerCopy}>
          <Text style={styles.pickerTitle}>{busy ? 'Import en cours…' : 'Choisir un fichier'}</Text>
          <Text style={styles.pickerSubtitle}>Tous les formats sont acceptés</Text>
        </View>
        <Ionicons color={colors.textFaint} name="chevron-forward" size={18} />
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
  disabled: externallyDisabled,
}: ImportScreenProps) {
  const [tags, setTags] = useState<Record<MediaKind | 'texte', string>>({
    hook: '',
    capture: '',
    musique: '',
    texte: '',
  });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<ImportBusy>(null);

  const setTag = (key: MediaKind | 'texte', value: string) => {
    setTags((current) => ({ ...current, [key]: value }));
  };

  const handlePick = async (type: MediaKind) => {
    if (externallyDisabled || busy !== null) return;
    try {
      const selection = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (selection.canceled) return;
      const asset = selection.assets[0];
      if (!asset) return;

      setBusy(type);
      onBusyChange(true);
      await uploadMedia(asset, type, tags[type].trim() || undefined);
      await onRefresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTag(type, '');

      if (type === 'hook' || type === 'capture') onNavigateMontage();
      else Alert.alert('Import terminé', `${asset.name} est prêt dans Scaylit.`);
    } catch (error) {
      Alert.alert('Import impossible', errorMessage(error));
    } finally {
      setBusy(null);
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
          busy={busy === 'hook'}
          description="La première séquence qui arrête le scroll."
          disabled={disabled}
          onChange={(value) => setTag('hook', value)}
          onPick={() => void handlePick('hook')}
          tags={uniqueTags(library.hooks)}
          title="Importer un hook"
          type="hook"
          value={tags.hook}
        />
        <UploadBlock
          busy={busy === 'capture'}
          description="La démonstration ou capture qui suit le hook."
          disabled={disabled}
          onChange={(value) => setTag('capture', value)}
          onPick={() => void handlePick('capture')}
          tags={uniqueTags(library.captures)}
          title="Importer un screen recording"
          type="capture"
          value={tags.capture}
        />
        <UploadBlock
          busy={busy === 'musique'}
          description="Une bande-son choisie aléatoirement dans les lots."
          disabled={disabled}
          onChange={(value) => setTag('musique', value)}
          onPick={() => void handlePick('musique')}
          tags={uniqueTags(library.musiques)}
          title="Importer une musique"
          type="musique"
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
