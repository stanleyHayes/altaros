import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../components/common/Card';
import { useAuth } from '../../hooks/useAuth';
import { borderRadius, colors, spacing, typography } from '../../theme';
import privacyService, {
  CONFIRMATION_WORD,
  type DeletionPreview,
} from '../../services/privacy.service';

/**
 * Your data — export and account deletion.
 *
 * Apple 5.1.1(v) requires the deletion path to be inside the app; a link to a
 * website is a rejection. Ghana's Act 843 gives the same two rights: s.32 to
 * know what is held, s.33 to have it erased.
 *
 * The screen shows what SURVIVES deletion before asking anyone to confirm it.
 * A church must keep six years of financial records, so a giving history
 * outlives the account with the name removed — and somebody who finds that out
 * afterwards has been misled about something they were entitled to know first.
 */
export default function PrivacyScreen() {
  const { logout } = useAuth();
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setPreview(await privacyService.deletionPreview());
    } catch {
      setLoadError('We could not load your privacy details. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onExport = async () => {
    setExporting(true);
    try {
      const json = await privacyService.exportMyData();
      await Share.share({
        title: 'My ALTAR OS data',
        message: json,
      });
    } catch {
      Alert.alert('Could not prepare your data', 'Please try again in a moment.');
    } finally {
      setExporting(false);
    }
  };

  const onDelete = () => {
    if (confirmText.trim().toUpperCase() !== CONFIRMATION_WORD) return;

    Alert.alert(
      'Delete your account?',
      'You will be signed out immediately and will not be able to sign in again. ' +
        'We keep the reference so you can undo this if it was a mistake.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const receipt = await privacyService.deleteMyAccount(CONFIRMATION_WORD);
              const until = new Date(receipt.purgeAfter).toLocaleDateString();
              Alert.alert(
                'Your account is deleted',
                `You are signed out and cannot sign in again.\n\n` +
                  `If this was a mistake you can restore it until ${until} using this reference:\n\n` +
                  `${receipt.reference}\n\n` +
                  `Write it down now — it is not shown again. After that date your data is ` +
                  `erased for good.`,
                [{ text: 'I have written it down', onPress: () => void logout() }],
                { cancelable: false },
              );
            } catch {
              Alert.alert(
                'Could not delete your account',
                'Nothing has been changed. Please try again in a moment.',
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (loadError || !preview) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{loadError}</Text>
        <TouchableOpacity onPress={() => void load()} style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const kept = preview.whatWeHold.filter((h) => h.disposition !== 'erased');
  const canDelete = confirmText.trim().toUpperCase() === CONFIRMATION_WORD && !busy;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <View style={styles.rowHead}>
          <Ionicons name="download-outline" size={20} color={colors.primary} />
          <Text style={styles.cardTitle}>Download my data</Text>
        </View>
        <Text style={styles.body}>
          A copy of everything we hold about you — your profile, giving, prayer
          requests, posts and more.
        </Text>
        <TouchableOpacity
          style={[styles.button, exporting && styles.buttonDisabled]}
          onPress={() => void onExport()}
          disabled={exporting}
          accessibilityRole="button"
          accessibilityLabel="Download my data"
        >
          {exporting ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text style={styles.buttonText}>Download my data</Text>
          )}
        </TouchableOpacity>
      </Card>

      <Card style={[styles.card, styles.danger]}>
        <View style={styles.rowHead}>
          <Ionicons name="trash-outline" size={20} color={colors.error} />
          <Text style={[styles.cardTitle, { color: colors.error }]}>
            Delete my account
          </Text>
        </View>
        <Text style={styles.body}>{preview.summary}</Text>

        {kept.length > 0 && (
          <View style={styles.keptBox}>
            <Text style={styles.keptTitle}>What is kept, and why</Text>
            {kept.map((h) => (
              <View key={h.label} style={styles.keptRow}>
                <Text style={styles.keptLabel}>{h.label}</Text>
                <Text style={styles.keptWhy}>{h.because}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.confirmLabel}>
          Type {CONFIRMATION_WORD} to confirm
        </Text>
        <TextInput
          style={styles.input}
          value={confirmText}
          onChangeText={setConfirmText}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder={CONFIRMATION_WORD}
          placeholderTextColor={colors.muted}
          accessibilityLabel={`Type ${CONFIRMATION_WORD} to confirm deletion`}
        />

        <TouchableOpacity
          style={[styles.button, styles.deleteButton, !canDelete && styles.buttonDisabled]}
          onPress={onDelete}
          disabled={!canDelete}
          accessibilityRole="button"
          accessibilityLabel="Delete my account"
        >
          {busy ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text style={styles.buttonText}>Delete my account</Text>
          )}
        </TouchableOpacity>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: { padding: spacing.md, marginBottom: spacing.md },
  danger: { borderColor: colors.error, borderWidth: 1 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  cardTitle: { color: colors.text, fontFamily: typography.families.bold, fontSize: typography.sizes.lg },
  body: { color: colors.textSecondary, fontFamily: typography.families.regular, fontSize: typography.sizes.md, lineHeight: 21, marginBottom: spacing.md },
  keptBox: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  keptTitle: { color: colors.text, fontFamily: typography.families.bold, fontSize: typography.sizes.sm, marginBottom: spacing.xs },
  keptRow: { marginBottom: spacing.sm },
  keptLabel: { color: colors.text, fontFamily: typography.families.medium, fontSize: typography.sizes.sm },
  keptWhy: { color: colors.textSecondary, fontFamily: typography.families.regular, fontSize: typography.sizes.xs, lineHeight: 17 },
  confirmLabel: { color: colors.textSecondary, fontFamily: typography.families.medium, fontSize: typography.sizes.xs, letterSpacing: 1, marginBottom: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
    color: colors.text,
    fontFamily: typography.families.regular,
    fontSize: typography.sizes.md,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  deleteButton: { backgroundColor: colors.error },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.surface, fontFamily: typography.families.bold, fontSize: typography.sizes.md },
  error: { color: colors.error, fontFamily: typography.families.regular, fontSize: typography.sizes.md, textAlign: 'center', marginBottom: spacing.md },
  retry: { padding: spacing.sm },
  retryText: { color: colors.primary, fontFamily: typography.families.bold, fontSize: typography.sizes.md },
});
