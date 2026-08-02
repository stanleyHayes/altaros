import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  RefreshControl,
  AppState,
} from 'react-native';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, borderRadius } from '../../theme';
import welfareService, { MAX_WELFARE_DESCRIPTION_LENGTH, type WelfareCategory, type WelfareRequest, type WelfareStatus, type WelfareUrgency } from '../../services/welfare.service';
import { createSubmissionLock } from '../../services/submission-lock';
import { useAuth } from '../../hooks/useAuth';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import { createLatestRequestGate } from '../../services/latest-request';
import { insertUniqueById } from '../../services/list-reconciliation';
import { connectivityErrorMessage } from '../../services/connectivity';
import { ScreenSkeleton } from '../../components/common/ScreenSkeleton';
import {
  createEmergencyConfirmationGate,
  expireEmergencyConfirmation,
  welfareMutationCompletionBelongsToIdentity,
  welfareStateBelongsToIdentity,
  type WelfareOwner,
} from './welfare-state';
import { Ionicons } from '@expo/vector-icons';

const categories: { value: WelfareCategory; label: string }[] = [
  { value: 'medical', label: 'Medical' },
  { value: 'financial', label: 'Financial' },
  { value: 'food', label: 'Food' },
  { value: 'housing', label: 'Housing' },
  { value: 'counseling', label: 'Counselling' },
  { value: 'other', label: 'Other' },
];

const urgencies: { value: WelfareUrgency; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const statusLabels: Record<WelfareStatus, string> = {
  pending: 'Pending',
  under_review: 'Under review',
  approved: 'Approved',
  fulfilled: 'Fulfilled',
  declined: 'Declined',
};

const statusColors: Record<WelfareStatus, string> = {
  pending: colors.info,
  under_review: colors.warning,
  approved: colors.success,
  fulfilled: colors.success,
  declined: colors.muted,
};

export function WelfareScreen() {
  const { user } = useAuth();
  const offline = useKnownOffline();
  const [category, setCategory] = useState<WelfareCategory>('medical');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState<WelfareUrgency>('medium');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [emergencySubmitting, setEmergencySubmitting] = useState(false);
  const [requests, setRequests] = useState<WelfareRequest[]>([]);
  const [stateOwner, setStateOwner] = useState<WelfareOwner | null>(() => ({
    churchId: user?.churchId,
    memberId: user?.id,
  }));
  const [loadError, setLoadError] = useState('');
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [refreshingRequests, setRefreshingRequests] = useState(false);
  const submissionLock = useRef(createSubmissionLock());
  const emergencyLock = useRef(createSubmissionLock());
  const emergencyConfirmationGate = useRef(createEmergencyConfirmationGate());
  const loadGate = useRef(createLatestRequestGate());
  const mountedRef = useRef(true);
  const activeIdentityRef = useRef<WelfareOwner>({ churchId: user?.churchId, memberId: user?.id });
  const stateOwnerRef = useRef(stateOwner);
  activeIdentityRef.current = { churchId: user?.churchId, memberId: user?.id };
  stateOwnerRef.current = stateOwner;

  const loadRequests = useCallback(async (refresh = false) => {
    const request = loadGate.current.begin();
    const startedOwner = { churchId: user?.churchId, memberId: user?.id };
    if (!welfareStateBelongsToIdentity(stateOwnerRef.current, startedOwner)) {
      stateOwnerRef.current = startedOwner;
      setStateOwner(startedOwner);
      setRequests([]);
      setCategory('medical');
      setDescription('');
      setUrgency('medium');
      setIsAnonymous(false);
      setSubmitting(false);
      setEmergencySubmitting(false);
      submissionLock.current = createSubmissionLock();
      emergencyLock.current = createSubmissionLock();
      emergencyConfirmationGate.current.invalidate();
    }
    setLoadError('');
    if (refresh) setRefreshingRequests(true);
    else setLoadingRequests(true);
    try {
      if (!user?.churchId || !user.id) throw new Error('Member identity is incomplete');
      const result = await welfareService.listMine(user.churchId, user.id);
      if (loadGate.current.isLatest(request)) {
        setRequests(result);
        const loadedOwner = { churchId: user.churchId, memberId: user.id };
        stateOwnerRef.current = loadedOwner;
        setStateOwner(loadedOwner);
      }
    } catch (cause) {
      if (loadGate.current.isLatest(request)) {
        setLoadError(connectivityErrorMessage(cause, 'Your requests could not be loaded.'));
      }
    } finally {
      if (loadGate.current.isLatest(request)) {
        setLoadingRequests(false);
        setRefreshingRequests(false);
      }
    }
  }, [user?.churchId, user?.id]);

  useEffect(() => {
    mountedRef.current = true;
    const gate = loadGate.current;
    void loadRequests();
    return () => {
      mountedRef.current = false;
      gate.invalidate();
    };
  }, [loadRequests]);

  useEffect(() => {
    const confirmationGate = emergencyConfirmationGate.current;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') return;
      expireEmergencyConfirmation(
        confirmationGate,
        () => emergencyLock.current.release(),
      );
    });
    return () => {
      subscription.remove();
      expireEmergencyConfirmation(
        confirmationGate,
        () => emergencyLock.current.release(),
      );
    };
  }, []);

  const ownsActiveIdentity = (churchId: string, memberId: string) => (
    welfareMutationCompletionBelongsToIdentity(
      mountedRef.current,
      activeIdentityRef.current,
      churchId,
      memberId,
    )
  );

  const handleSubmit = async () => {
    if (!description.trim()) {
      Alert.alert('Describe your request', 'Please tell the pastoral team what support you need.');
      return;
    }
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.id;
    if (!startedChurchId || !startedMemberId) {
      Alert.alert('Request not sent', 'Your member session is incomplete. Sign in again and retry.');
      return;
    }
    const actionLock = submissionLock.current;
    if (!actionLock.acquire()) return;

    setSubmitting(true);
    try {
      const created = await welfareService.create(
        { category, description: description.trim(), urgency, isAnonymous },
        startedChurchId,
        startedMemberId,
      );
      if (!ownsActiveIdentity(startedChurchId, startedMemberId)) return;
      setRequests((current) => insertUniqueById(current, created, 'start'));
      Alert.alert(
        'Request sent',
        'Your request has been sent privately to the pastoral team. Someone will reach out to you.',
      );
      setDescription('');
      setUrgency('medium');
      setIsAnonymous(false);
    } catch {
      if (startedChurchId && startedMemberId
        && ownsActiveIdentity(startedChurchId, startedMemberId)) {
        Alert.alert('Request not sent', 'Check your connection and try again.');
      }
    } finally {
      actionLock.release();
      if (ownsActiveIdentity(startedChurchId, startedMemberId)) setSubmitting(false);
    }
  };

  const sendEmergency = async (
    actionLock: ReturnType<typeof createSubmissionLock>,
    startedChurchId: string,
    startedMemberId: string,
    emergencyDescription: string | undefined,
  ) => {
    if (!ownsActiveIdentity(startedChurchId, startedMemberId)) {
      actionLock.release();
      return;
    }
    setEmergencySubmitting(true);
    try {
      await welfareService.emergency(
        emergencyDescription,
        startedChurchId,
        startedMemberId,
      );
      if (ownsActiveIdentity(startedChurchId, startedMemberId)) {
        Alert.alert('Alert sent', 'The pastoral team has been notified. If you are in immediate danger, contact local emergency services now.');
      }
    } catch {
      if (ownsActiveIdentity(startedChurchId, startedMemberId)) {
        Alert.alert('Alert not sent', 'Contact local emergency services now if you are in immediate danger.');
      }
    } finally {
      actionLock.release();
      if (ownsActiveIdentity(startedChurchId, startedMemberId)) setEmergencySubmitting(false);
    }
  };

  const handleEmergency = () => {
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.id;
    if (!startedChurchId || !startedMemberId
      || !ownsActiveIdentity(startedChurchId, startedMemberId)) return;
    const emergencyDescription = description.trim() || undefined;
    const actionLock = emergencyLock.current;
    if (!actionLock.acquire()) return;
    const confirmationToken = emergencyConfirmationGate.current.begin();
    let alertStarted = false;
    Alert.alert(
      'Send emergency alert?',
      'This sends an internet-dependent alert to your pastoral team. It does not replace emergency services.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => {
            if (emergencyConfirmationGate.current.cancel(confirmationToken)) actionLock.release();
          },
        },
        {
          text: 'Send alert',
          style: 'destructive',
          onPress: () => {
            if (!emergencyConfirmationGate.current.consume(confirmationToken)) {
              actionLock.release();
              return;
            }
            alertStarted = true;
            void sendEmergency(
              actionLock,
              startedChurchId,
              startedMemberId,
              emergencyDescription,
            );
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          if (!alertStarted
            && emergencyConfirmationGate.current.cancel(confirmationToken)) actionLock.release();
        },
      },
    );
  };

  const ownsState = welfareStateBelongsToIdentity(stateOwner, activeIdentityRef.current);
  if (!ownsState) return <ScreenSkeleton cards={4} showHero />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={(
        <RefreshControl
          refreshing={refreshingRequests}
          onRefresh={() => { if (!offline) void loadRequests(true); }}
          enabled={!offline}
          tintColor={colors.primary}
        />
      )}
    >
      {/* Emergency */}
      <Card style={styles.emergencyCard}>
        <View style={styles.emergencyHeading}>
          <View style={styles.emergencyIcon}><Ionicons name="pulse-outline" size={22} color={colors.error} /></View>
          <View style={styles.emergencyCopy}>
            <Text style={styles.emergencyEyebrow}>PRIVATE PASTORAL CARE</Text>
            <Text style={styles.emergencyTitle}>Need urgent help?</Text>
          </View>
        </View>
        <Text style={styles.emergencyBody}>Alert your church&apos;s pastoral team over the internet. If you are in immediate danger, contact local emergency services first.</Text>
        <TouchableOpacity
          style={[styles.emergencyButton, (offline || emergencySubmitting) && styles.actionDisabled]}
          onPress={handleEmergency}
          disabled={offline || emergencySubmitting}
          accessibilityRole="button"
          accessibilityLabel="Send emergency alert"
          accessibilityHint={offline ? 'Reconnect to send this internet-dependent alert. Contact local emergency services if you are in danger.' : undefined}
          accessibilityState={{ disabled: offline || emergencySubmitting, busy: emergencySubmitting }}
        >
          <Text style={styles.emergencyButtonText}>{emergencySubmitting ? 'Sending alert…' : 'Send Emergency Alert'}</Text>
        </TouchableOpacity>
      </Card>

      {/* Request assistance */}
      <Text style={styles.sectionEyebrow}>A PRIVATE REQUEST</Text>
      <Text style={styles.sectionTitle}>Tell the pastoral team what you need.</Text>
      <Card style={styles.formCard}>
        <Text style={styles.label}>Category</Text>
        <View style={styles.chipRow}>
          {categories.map((item) => {
            const selected = item.value === category;
            return (
              <TouchableOpacity
                key={item.value}
                onPress={() => setCategory(item.value)}
                style={[styles.chip, selected && styles.chipSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${item.label} welfare category`}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Input
          label="What support do you need?"
          value={description}
          onChangeText={setDescription}
          placeholder="Share only what the pastoral team needs to know"
          multiline
          numberOfLines={4}
          maxLength={MAX_WELFARE_DESCRIPTION_LENGTH}
        />
        <Text
          style={styles.characterCount}
          accessibilityLabel={`${MAX_WELFARE_DESCRIPTION_LENGTH - description.length} characters remaining`}
        >
          {description.length}/{MAX_WELFARE_DESCRIPTION_LENGTH}
        </Text>

        <Text style={styles.label}>Urgency</Text>
        <View style={styles.chipRow}>
          {urgencies.map((item) => {
            const selected = item.value === urgency;
            return (
              <TouchableOpacity
                key={item.value}
                onPress={() => setUrgency(item.value)}
                style={[styles.chip, selected && styles.chipSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${item.label} welfare urgency`}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          style={styles.anonymousToggle}
          onPress={() => setIsAnonymous((current) => !current)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isAnonymous }}
          accessibilityLabel="Hide my name from the shared request"
        >
          <View style={[styles.checkbox, isAnonymous && styles.checkboxChecked]}>
            {isAnonymous ? <Text style={styles.checkmark}>✓</Text> : null}
          </View>
          <Text style={styles.anonymousLabel}>Submit anonymously</Text>
        </TouchableOpacity>

        <Text style={styles.privacyNote}>
          Welfare requests are private to assigned pastoral roles. Anonymous requests hide your name in the shared case, but authorised safety and audit systems may still retain your member record.
        </Text>

        <Button
          title="Submit Request"
          onPress={handleSubmit}
          loading={submitting}
          disabled={offline || submitting}
          accessibilityHint={offline ? 'Reconnect to send this private request.' : undefined}
        />
      </Card>

      {/* Existing requests */}
      <Text style={styles.sectionEyebrow}>YOUR CARE HISTORY</Text>
      <Text style={styles.sectionTitle}>Your requests</Text>
      {loadError ? <View><Text style={styles.loadError} accessibilityRole="alert">{loadError}</Text><TouchableOpacity style={[styles.textAction, offline && styles.actionDisabled]} onPress={() => void loadRequests(true)} accessibilityRole="button" disabled={offline} accessibilityState={{ disabled: offline }} accessibilityHint={offline ? 'Reconnect to load your private welfare requests.' : undefined}><Text style={styles.retry}>{offline ? 'Reconnect to retry' : 'Try again'}</Text></TouchableOpacity></View> : null}
      {loadingRequests ? (
        <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your private welfare requests">
          {[0, 1].map((key) => (
            <Card key={key} style={styles.requestCard}>
              <View style={styles.skeletonHeader}>
                <View style={[styles.skeletonLine, styles.skeletonCategory]} />
                <View style={[styles.skeletonLine, styles.skeletonStatus]} />
              </View>
              <View style={[styles.skeletonLine, styles.skeletonSummary]} />
              <View style={[styles.skeletonLine, styles.skeletonDate]} />
            </Card>
          ))}
        </View>
      ) : !loadError && requests.length === 0 ? (
        <Card>
          <Text style={styles.emptyText}>You have no welfare requests yet.</Text>
        </Card>
      ) : (
        requests.map((request) => (
          <Card key={request.id} style={styles.requestCard}>
            <View style={styles.requestHeader}>
              <Text style={styles.requestCategory}>
                {categories.find((c) => c.value === request.category)?.label ??
                  'Other'}
              </Text>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: `${statusColors[request.status]}22` },
                ]}
              >
                <Text
                  style={[styles.statusText, { color: statusColors[request.status] }]}
                >
                  {statusLabels[request.status]}
                </Text>
              </View>
            </View>
            <Text style={styles.requestSummary}>{request.description}</Text>
            <Text style={styles.requestMeta}>{urgencies.find((item) => item.value === request.urgency)?.label ?? request.urgency} urgency{request.isAnonymous ? ' · Anonymous' : ''}</Text>
            <Text style={styles.requestDate}>
              {new Date(request.createdAt).toLocaleDateString()}
            </Text>
          </Card>
        ))
      )}

      <View style={styles.footerSpace} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    padding: spacing.base,
  },
  emergencyCard: {
    marginBottom: spacing.xl,
    borderColor: '#F1D4D0',
    backgroundColor: '#FFF8F6',
    borderRadius: borderRadius['2xl'],
  },
  emergencyHeading: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  emergencyIcon: { width: 46, height: 46, borderRadius: borderRadius.md, backgroundColor: '#FDE9E5', alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  emergencyCopy: { flex: 1 },
  emergencyEyebrow: { color: colors.error, fontFamily: typography.families.bold, fontSize: 9, letterSpacing: 1.1, marginBottom: 2 },
  emergencyTitle: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.families.bold,
    color: colors.text,
  },
  emergencyBody: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    marginBottom: spacing.base,
  },
  emergencyButton: {
    backgroundColor: colors.error,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  emergencyButtonText: {
    color: colors.surface,
    fontSize: typography.sizes.base,
    fontFamily: typography.families.semibold,
  },
  actionDisabled: { opacity: 0.5 },
  sectionEyebrow: { color: colors.primary, fontFamily: typography.families.bold, fontSize: typography.sizes.xs, letterSpacing: 1.35, marginBottom: spacing.xs },
  sectionTitle: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.families.bold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  formCard: {
    marginBottom: spacing.xl,
  },
  label: {
    fontSize: typography.sizes.md,
    fontFamily: typography.families.semibold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.base,
  },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    fontFamily: typography.families.medium,
  },
  chipTextSelected: {
    color: colors.surface,
    fontFamily: typography.families.semibold,
  },
  privacyNote: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
    marginBottom: spacing.base,
    lineHeight: 18,
  },
  characterCount: {
    marginTop: -spacing.sm,
    marginBottom: spacing.base,
    color: colors.muted,
    fontSize: typography.sizes.sm,
    textAlign: 'right',
  },
  anonymousToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  checkbox: { width: 24, height: 24, borderRadius: borderRadius.sm, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.surface, fontFamily: typography.families.bold },
  anonymousLabel: { color: colors.textSecondary, fontSize: typography.sizes.md },
  requestCard: {
    marginBottom: spacing.md,
  },
  skeletonHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  skeletonLine: { height: 12, borderRadius: borderRadius.full, backgroundColor: colors.border },
  skeletonCategory: { width: '32%' },
  skeletonStatus: { width: 72 },
  skeletonSummary: { width: '84%', marginBottom: spacing.md },
  skeletonDate: { width: '28%', height: 10 },
  requestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  requestCategory: {
    fontSize: typography.sizes.base,
    fontFamily: typography.families.semibold,
    color: colors.text,
  },
  statusPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  statusText: {
    fontSize: typography.sizes.sm,
    fontFamily: typography.families.semibold,
  },
  requestSummary: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  requestMeta: { color: colors.muted, fontSize: typography.sizes.sm, marginBottom: spacing.xs },
  requestDate: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
  },
  emptyText: {
    fontSize: typography.sizes.md,
    color: colors.muted,
    textAlign: 'center',
  },
  loadError: { color: colors.error, fontSize: typography.sizes.md, marginBottom: spacing.md },
  retry: { color: colors.primary, fontFamily: typography.families.semibold, fontSize: typography.sizes.md, marginBottom: spacing.md },
  textAction: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  footerSpace: {
    height: spacing['3xl'],
  },
});
