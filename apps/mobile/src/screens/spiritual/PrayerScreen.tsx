import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
  RefreshControl,
} from 'react-native';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, borderRadius } from '../../theme';
import spiritualService, { MAX_PRAYER_DESCRIPTION_LENGTH, PRAYER_PAGE_SIZE, type PrayerRequest } from '../../services/spiritual.service';
import { ScreenSkeleton } from '../../components/common/ScreenSkeleton';
import { createKeyedSubmissionLock, createSubmissionLock } from '../../services/submission-lock';
import { useAuth } from '../../hooks/useAuth';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import { createLatestRequestGate } from '../../services/latest-request';
import { appendUniquePageById, insertUniqueById, reconcileIncrementCount } from '../../services/list-reconciliation';
import { connectivityErrorMessage } from '../../services/connectivity';
import { Ionicons } from '@expo/vector-icons';
import { StatePanel } from '../../components/common/StatePanel';
import { useAnimatedRouteTop } from '../../hooks/useAnimatedRouteTop';
import { apiErrorMessage, isAmbiguousMutationFailure } from '../../services/api-error';
import { paginationActionState } from '../../components/common/pagination-action';
import { formKeyboardProps } from '../../components/common/form-keyboard';

export interface PrayerMutationContext {
  churchId?: string;
  memberId?: string;
}

export function ownsPrayerMutationContext(
  active: PrayerMutationContext,
  startedChurchId: string,
  startedMemberId: string,
): boolean {
  return active.churchId === startedChurchId && active.memberId === startedMemberId;
}

export function prayerMutationCompletionBelongsToContext(
  mounted: boolean,
  active: PrayerMutationContext,
  startedChurchId: string,
  startedMemberId: string,
): boolean {
  return mounted && ownsPrayerMutationContext(active, startedChurchId, startedMemberId);
}

export function prayerRefreshOwnsReconciliation(
  startedRevision: number,
  activeRevision: number,
): boolean {
  return startedRevision === activeRevision;
}

export function prayerMutationFailureAlert(
  kind: 'create' | 'pray',
  error: unknown,
): { outcomeUnknown: boolean; title: string; message: string } {
  if (isAmbiguousMutationFailure(error)) {
    return kind === 'create'
      ? {
        outcomeUnknown: true,
        title: 'Request status unknown',
        message: 'We could not confirm whether your prayer request was shared. Refresh the prayer wall before submitting it again.',
      }
      : {
        outcomeUnknown: true,
        title: 'Prayer status unknown',
        message: 'We could not confirm whether your prayer was counted. Refresh the prayer wall before pressing Pray again.',
      };
  }
  return kind === 'create'
    ? {
      outcomeUnknown: false,
      title: 'Request not shared',
      message: apiErrorMessage(error, 'Check your connection and try again.'),
    }
    : {
      outcomeUnknown: false,
      title: 'Not saved',
      message: 'We could not record that prayer. Try again.',
    };
}

export function prayerRequestActionState(
  title: string,
  description: string,
  offline: boolean,
  busy: boolean,
  outcomeUnknown: boolean,
  identityReady: boolean,
) {
  const draftComplete = Boolean(title.trim() && description.trim());
  return {
    mode: outcomeUnknown ? 'refresh' : 'submit',
    label: outcomeUnknown
      ? busy ? 'Refreshing prayer wall…' : offline ? 'Reconnect to refresh prayer wall' : 'Refresh prayer wall to continue'
      : busy ? 'Sharing prayer request…'
        : offline ? 'Reconnect to share your request'
          : !identityReady ? 'Sign in again to share'
            : !draftComplete ? 'Complete title and description' : 'Submit prayer request',
    disabled: outcomeUnknown ? offline || busy : offline || busy || !identityReady || !draftComplete,
    hint: outcomeUnknown
      ? offline ? 'Reconnect to confirm whether your request was shared.' : 'Refreshes the prayer wall before another request can be submitted.'
      : offline ? 'Reconnect to share this prayer request.'
        : !identityReady ? 'Your member session is incomplete. Sign in again.'
          : !draftComplete ? 'Add both a title and description.' : undefined,
  } as const;
}

export function prayActionState(
  count: number,
  offline: boolean,
  busy: boolean,
  outcomeUnknown: boolean,
  refreshing: boolean,
) {
  return {
    mode: outcomeUnknown ? 'refresh' : 'pray',
    label: outcomeUnknown
      ? refreshing ? 'Refreshing prayer status…' : offline ? 'Reconnect to refresh prayer status' : 'Refresh prayer status'
      : busy ? 'Recording your prayer…' : offline ? 'Reconnect to pray' : `Pray (${count})`,
    disabled: outcomeUnknown ? offline || refreshing : offline || busy || refreshing,
    hint: outcomeUnknown
      ? offline ? 'Reconnect to confirm whether your prayer was counted.' : 'Refreshes the prayer wall before praying again.'
      : offline ? 'Reconnect to record that you prayed.' : undefined,
  } as const;
}

export function PrayerScreen() {
  const { user } = useAuth();
  const offline = useKnownOffline();
  const scrollRef = useRef<ScrollView>(null);
  useAnimatedRouteTop(scrollRef);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitOutcomeUnknown, setSubmitOutcomeUnknown] = useState(false);
  const [requests, setRequests] = useState<PrayerRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadedPage, setLoadedPage] = useState(0);
  const [totalRequests, setTotalRequests] = useState(0);
  const [pagingNeedsRefresh, setPagingNeedsRefresh] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [prayingIds, setPrayingIds] = useState<Set<string>>(() => new Set());
  const [prayUnknownIds, setPrayUnknownIds] = useState<Set<string>>(() => new Set());
  const submissionLock = useRef(createSubmissionLock());
  const prayerActionLock = useRef(createKeyedSubmissionLock());
  const loadGate = useRef(createLatestRequestGate());
  const mountedRef = useRef(true);
  const activeContextRef = useRef<PrayerMutationContext>({
    churchId: user?.churchId,
    memberId: user?.memberId,
  });
  const previousContextRef = useRef(activeContextRef.current);
  const activeRequestIdsRef = useRef(new Set<string>());
  const submitOutcomeUnknownRef = useRef(submitOutcomeUnknown);
  const reconciliationRevisionRef = useRef(0);
  activeContextRef.current = { churchId: user?.churchId, memberId: user?.memberId };
  activeRequestIdsRef.current = new Set(requests.map((request) => request.id));
  submitOutcomeUnknownRef.current = submitOutcomeUnknown;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const previous = previousContextRef.current;
    const current = activeContextRef.current;
    if (previous.churchId !== current.churchId || previous.memberId !== current.memberId) {
      loadGate.current.invalidate();
      setRequests([]);
      setLoadedPage(0);
      setTotalRequests(0);
      setPagingNeedsRefresh(false);
      setTitle('');
      setDescription('');
      setIsAnonymous(false);
      setShowForm(false);
      setLoadError('');
      setPrayingIds(new Set());
      setPrayUnknownIds(new Set());
      setIsSubmitting(false);
      setSubmitOutcomeUnknown(false);
      submitOutcomeUnknownRef.current = false;
      reconciliationRevisionRef.current += 1;
      submissionLock.current = createSubmissionLock();
      prayerActionLock.current = createKeyedSubmissionLock();
      previousContextRef.current = current;
    }
  }, [user?.churchId, user?.memberId]);

  const ownsActiveContext = (churchId: string, memberId: string) => (
    prayerMutationCompletionBelongsToContext(
      mountedRef.current,
      activeContextRef.current,
      churchId,
      memberId,
    )
  );

  const loadRequests = useCallback(async (refresh = false, page = 1) => {
    const request = loadGate.current.begin();
    const startedReconciliationRevision = reconciliationRevisionRef.current;
    if (page > 1) setIsLoadingMore(true);
    else if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    setLoadError('');
    try {
      if (!user?.churchId) throw new Error('No church selected');
      const result = await spiritualService.getPrayerRequests(user.churchId, {
        page,
        limit: PRAYER_PAGE_SIZE,
      });
      if (loadGate.current.isLatest(request)) {
        setRequests((current) => page === 1
          ? result.requests
          : appendUniquePageById(current, result.requests));
        setLoadedPage(page);
        setTotalRequests(result.total);
        if (page === 1) {
          setPagingNeedsRefresh(false);
          if (prayerRefreshOwnsReconciliation(
            startedReconciliationRevision,
            reconciliationRevisionRef.current,
          )) {
            setPrayUnknownIds(new Set());
            if (submitOutcomeUnknownRef.current) {
              setTitle('');
              setDescription('');
              setIsAnonymous(false);
              setShowForm(false);
            }
            setSubmitOutcomeUnknown(false);
            submitOutcomeUnknownRef.current = false;
          }
        }
      }
    } catch (cause) {
      if (loadGate.current.isLatest(request)) {
        setLoadError(connectivityErrorMessage(cause, 'Prayer requests are unavailable right now.'));
      }
    } finally {
      if (loadGate.current.isLatest(request)) {
        setIsLoading(false);
        setIsRefreshing(false);
        setIsLoadingMore(false);
      }
    }
  }, [user?.churchId]);

  useEffect(() => {
    const gate = loadGate.current;
    void loadRequests();
    return () => gate.invalidate();
  }, [loadRequests]);

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) {
      Alert.alert('Missing Fields', 'Please fill in both title and description.');
      return;
    }
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.memberId;
    if (!startedChurchId || !startedMemberId) {
      Alert.alert('Request not shared', 'Your member session is incomplete. Sign in again and retry.');
      return;
    }
    const actionLock = submissionLock.current;
    if (!actionLock.acquire()) return;

    setIsSubmitting(true);
    try {
      const created = await spiritualService.createPrayerRequest(
        { title: title.trim(), description: description.trim(), isAnonymous },
        startedChurchId,
        startedMemberId,
      );
      if (!ownsActiveContext(startedChurchId, startedMemberId)) return;
      setRequests((current) => insertUniqueById(current, created, 'start'));
      setTotalRequests((current) => current + 1);
      setPagingNeedsRefresh(true);
      Alert.alert('Prayer request shared', 'Your church community can now pray with you.');
      setTitle('');
      setDescription('');
      setIsAnonymous(false);
      setShowForm(false);
      void loadRequests(true);
    } catch (error) {
      if (startedChurchId && startedMemberId && ownsActiveContext(startedChurchId, startedMemberId)) {
        const copy = prayerMutationFailureAlert('create', error);
        setSubmitOutcomeUnknown(copy.outcomeUnknown);
        submitOutcomeUnknownRef.current = copy.outcomeUnknown;
        if (copy.outcomeUnknown) reconciliationRevisionRef.current += 1;
        Alert.alert(copy.title, copy.message);
      }
    } finally {
      actionLock.release();
      if (ownsActiveContext(startedChurchId, startedMemberId)) setIsSubmitting(false);
    }
  };

  const handlePray = async (requestId: string) => {
    const actionLock = prayerActionLock.current;
    if (!actionLock.acquire(requestId)) return;
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.memberId;
    if (!startedChurchId || !startedMemberId
      || !ownsActiveContext(startedChurchId, startedMemberId)
      || !activeRequestIdsRef.current.has(requestId)) {
      actionLock.release(requestId);
      return;
    }
    const startedAt = requests.find((request) => request.id === requestId)?.prayerCount ?? 0;
    setPrayingIds((current) => new Set(current).add(requestId));
    try {
      const result = await spiritualService.prayForRequest(requestId);
      if (!ownsActiveContext(startedChurchId, startedMemberId)
        || !activeRequestIdsRef.current.has(requestId)) return;
      setRequests((current) => current.map((request) => request.id === requestId ? {
        ...request,
        prayerCount: reconcileIncrementCount(request.prayerCount, startedAt, result.prayerCount),
      } : request));
    } catch (error) {
      if (ownsActiveContext(startedChurchId, startedMemberId)
        && activeRequestIdsRef.current.has(requestId)) {
        const copy = prayerMutationFailureAlert('pray', error);
        if (copy.outcomeUnknown) {
          reconciliationRevisionRef.current += 1;
          setPrayUnknownIds((current) => new Set(current).add(requestId));
        }
        Alert.alert(copy.title, copy.message);
      }
    } finally {
      actionLock.release(requestId);
      if (ownsActiveContext(startedChurchId, startedMemberId)
        && activeRequestIdsRef.current.has(requestId)) {
        setPrayingIds((current) => {
          const next = new Set(current);
          next.delete(requestId);
          return next;
        });
      }
    }
  };

  if (isLoading) return <ScreenSkeleton cards={4} />;

  const hasMoreRequests = requests.length < totalRequests;
  const requestAction = prayerRequestActionState(
    title,
    description,
    offline,
    isSubmitting || (submitOutcomeUnknown && isRefreshing),
    submitOutcomeUnknown,
    Boolean(user?.churchId && user?.memberId),
  );
  const paginationAction = paginationActionState('older requests', {
    offline,
    loading: isLoadingMore,
    refreshing: isRefreshing,
    requiresRefresh: pagingNeedsRefresh || Boolean(loadError),
  });

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      {...formKeyboardProps(Platform.OS)}
      refreshControl={(
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={() => { if (!offline) void loadRequests(true); }}
          enabled={!offline}
          tintColor={colors.primary}
        />
      )}
    >
      {/* Submit Button / Form Toggle */}
      <View style={styles.header}>
        <View style={styles.headerOrb} accessible={false} />
        <View style={styles.headerCopy}>
          <Text style={styles.headerEyebrow}>PRAYER WALL</Text>
          <Text style={styles.headerTitle}>Carry one another.</Text>
          <Text style={styles.headerBody}>Share privately or invite your church community to pray with you.</Text>
        </View>
        <Button
          title={showForm ? 'Cancel' : 'Submit Prayer Request'}
          onPress={() => setShowForm(!showForm)}
          variant={showForm ? 'outline' : 'primary'}
          fullWidth
          disabled={isSubmitting || submitOutcomeUnknown}
        />
      </View>

      {/* Prayer Request Form */}
      {showForm && (
        <Card style={styles.formCard}>
          <Text style={styles.formTitle}>New Prayer Request</Text>

          <Input
            label="Title"
            placeholder="Brief title for your request"
            value={title}
            onChangeText={setTitle}
            maxLength={200}
            editable={!isSubmitting && !submitOutcomeUnknown}
          />

          <Input
            label="Description"
            placeholder="Share your prayer request..."
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
            style={styles.textArea}
            maxLength={MAX_PRAYER_DESCRIPTION_LENGTH}
            editable={!isSubmitting && !submitOutcomeUnknown}
          />
          <Text
            style={styles.characterCount}
            accessibilityLabel={`${MAX_PRAYER_DESCRIPTION_LENGTH - description.length} prayer-description characters remaining`}
          >
            {description.length}/{MAX_PRAYER_DESCRIPTION_LENGTH}
          </Text>

          <TouchableOpacity
            style={[styles.anonymousToggle, (isSubmitting || submitOutcomeUnknown) && styles.actionDisabled]}
            onPress={() => setIsAnonymous(!isAnonymous)}
            disabled={isSubmitting || submitOutcomeUnknown}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isAnonymous, disabled: isSubmitting || submitOutcomeUnknown }}
          >
            <View
              style={[
                styles.checkbox,
                isAnonymous && styles.checkboxChecked,
              ]}
            >
              {isAnonymous && <Text style={styles.checkmark}>{'\u2713'}</Text>}
            </View>
            <Text style={styles.anonymousLabel}>Submit anonymously</Text>
          </TouchableOpacity>

          <Button
            title={requestAction.label}
            onPress={requestAction.mode === 'refresh' ? () => void loadRequests(true) : handleSubmit}
            loading={isSubmitting}
            disabled={requestAction.disabled}
            accessibilityHint={requestAction.hint}
            fullWidth
          />
        </Card>
      )}

      {/* Prayer Requests List */}
      <View style={styles.listSection}>
        <Text style={styles.sectionTitle}>Community Prayer Requests</Text>
        {loadError && requests.length > 0 ? (
          <View style={styles.errorBanner}>
            <Text style={styles.loadError} accessibilityRole="alert">{loadError}</Text>
            <TouchableOpacity style={[styles.textAction, offline && styles.actionDisabled]} onPress={() => void loadRequests(true)} accessibilityRole="button" disabled={offline} accessibilityState={{ disabled: offline }} accessibilityHint={offline ? 'Reconnect to refresh prayer requests.' : undefined}>
              <Text style={styles.retry}>{offline ? 'Reconnect to retry' : 'Try again'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {loadError && requests.length === 0 ? (
          <StatePanel
            icon={offline ? 'cloud-offline-outline' : 'sparkles-outline'}
            tone={offline ? 'offline' : 'error'}
            title={offline ? 'The prayer wall is offline' : 'Prayer wall unavailable'}
            message={loadError}
            actionLabel={offline ? 'Reconnect to retry' : 'Try again'}
            actionHint={offline ? 'Reconnect to load prayer requests.' : 'Loads prayer requests again.'}
            actionDisabled={offline}
            onAction={() => void loadRequests(true)}
          />
        ) : null}
        {!loadError && requests.length === 0 ? <StatePanel icon="sparkles-outline" title="A quiet prayer wall" message="No public prayer requests have been shared yet." /> : null}
        {requests.map((request) => {
          const prayAction = prayActionState(
            request.prayerCount,
            offline,
            prayingIds.has(request.id),
            prayUnknownIds.has(request.id),
            isRefreshing,
          );
          return <Card key={request.id} style={styles.requestCard}>
            <View style={styles.requestHeader}>
              <Text style={styles.requestTitle}>{request.title}</Text>
            </View>
            <Text style={styles.requestDescription} numberOfLines={3}>
              {request.description}
            </Text>
            <View style={styles.requestFooter}>
              <Text style={styles.requestAuthor}>
                {request.isAnonymous ? 'Anonymous' : request.authorName}
              </Text>
              <TouchableOpacity
                style={[styles.prayButton, prayAction.disabled && styles.actionDisabled]}
                onPress={prayAction.mode === 'refresh' ? () => void loadRequests(true) : () => void handlePray(request.id)}
                accessibilityRole="button"
                accessibilityLabel={`${prayAction.label} for ${request.title}. ${request.prayerCount} people praying`}
                accessibilityHint={prayAction.hint}
                accessibilityState={{ busy: prayingIds.has(request.id) || (prayUnknownIds.has(request.id) && isRefreshing), disabled: prayAction.disabled }}
                disabled={prayAction.disabled}
              >
                <Ionicons name="sparkles-outline" size={15} color={colors.primary} accessible={false} />
                <Text style={styles.prayButtonText}>
                  {prayAction.label}
                </Text>
              </TouchableOpacity>
            </View>
          </Card>;
        })}
        {requests.length > 0 ? (
          <View style={styles.footer}>
            {pagingNeedsRefresh ? (
              <TouchableOpacity
                style={[styles.loadMore, (offline || isRefreshing) && styles.actionDisabled]}
                onPress={() => void loadRequests(true)}
                disabled={offline || isRefreshing}
                accessibilityRole="button"
                accessibilityLabel="Refresh prayer wall to continue"
                accessibilityHint={offline ? 'Reconnect to refresh prayer requests.' : 'Refreshes the prayer wall after your new request.'}
                accessibilityState={{ disabled: offline || isRefreshing, busy: isRefreshing }}
              >
                <Text style={styles.loadMoreText}>{isRefreshing ? 'Refreshing prayer wall…' : 'Refresh to continue'}</Text>
              </TouchableOpacity>
            ) : hasMoreRequests ? (
              <TouchableOpacity
                style={[styles.loadMore, paginationAction.disabled && styles.actionDisabled]}
                onPress={() => void loadRequests(false, loadedPage + 1)}
                disabled={paginationAction.disabled}
                accessibilityRole="button"
                accessibilityLabel={paginationAction.label}
                accessibilityHint={paginationAction.hint}
                accessibilityState={{ disabled: paginationAction.disabled, busy: paginationAction.busy }}
              >
                <Text style={styles.loadMoreText}>{paginationAction.label}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.endText}>You’ve reached the beginning of the prayer wall.</Text>
            )}
          </View>
        ) : null}
      </View>
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
  },
  header: {
    backgroundColor: colors.text,
    margin: spacing.base,
    marginBottom: spacing.xl,
    borderRadius: borderRadius['2xl'],
    padding: spacing.xl,
    overflow: 'hidden',
  },
  headerOrb: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: '#174C45', top: -105, right: -45 },
  headerCopy: { marginBottom: spacing.lg, paddingRight: spacing.lg },
  headerEyebrow: { color: colors.primaryLight, fontFamily: typography.families.bold, fontSize: typography.sizes.xs, letterSpacing: 1.35 },
  headerTitle: { color: colors.surface, fontFamily: typography.families.bold, fontSize: typography.sizes['2xl'], letterSpacing: -.6, marginTop: spacing.sm },
  headerBody: { color: 'rgba(255,255,255,.65)', fontFamily: typography.families.regular, fontSize: typography.sizes.md, lineHeight: 20, marginTop: spacing.sm },
  formCard: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.xl,
  },
  formTitle: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.families.bold,
    color: colors.text,
    marginBottom: spacing.base,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  characterCount: {
    marginTop: -spacing.sm,
    marginBottom: spacing.base,
    color: colors.muted,
    fontSize: typography.sizes.sm,
    textAlign: 'right',
  },
  anonymousToggle: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.base,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: borderRadius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    marginRight: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: typography.families.bold,
  },
  anonymousLabel: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
  },
  listSection: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing['2xl'],
  },
  sectionTitle: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.families.bold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  requestCard: {
    marginBottom: spacing.md,
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  requestTitle: {
    fontSize: typography.sizes.base,
    fontFamily: typography.families.semibold,
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  requestDescription: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  requestFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  requestAuthor: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
  },
  prayButton: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: colors.primaryLight + '20',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  prayButtonText: {
    fontSize: typography.sizes.sm,
    color: colors.primary,
    fontFamily: typography.families.semibold,
  },
  actionDisabled: { opacity: 0.5 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, marginBottom: spacing.md },
  loadError: { color: colors.error, fontSize: typography.sizes.md, flex: 1 },
  retry: { color: colors.primary, fontFamily: typography.families.semibold, fontSize: typography.sizes.md, paddingVertical: spacing.sm },
  textAction: { minHeight: 44, justifyContent: 'center' },
  footer: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.xl },
  loadMore: { minHeight: 48, minWidth: 220, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primary, borderRadius: borderRadius.full, paddingHorizontal: spacing.xl },
  loadMoreText: { color: colors.primary, fontFamily: typography.families.semibold, fontSize: typography.sizes.sm },
  endText: { color: colors.muted, fontFamily: typography.families.medium, fontSize: typography.sizes.sm, textAlign: 'center' },
});
