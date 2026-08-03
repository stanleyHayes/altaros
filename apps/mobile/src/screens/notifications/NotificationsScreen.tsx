import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, FlatList, Linking, Platform, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Notifications from '../../services/notification-platform';
import { Card } from '../../components/common/Card';
import notificationService, { NOTIFICATION_PAGE_SIZE, rollbackNotificationReadAt, type MemberNotification, supportsNativePush } from '../../services/notification.service';
import { borderRadius, colors, spacing, typography } from '../../theme';
import { safeNotificationUrl } from '../../services/notification-linking';
import { ScreenSkeleton } from '../../components/common/ScreenSkeleton';
import { createKeyedSubmissionLock, createSubmissionLock } from '../../services/submission-lock';
import { useAuth } from '../../hooks/useAuth';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import { createLatestRequestGate } from '../../services/latest-request';
import { connectivityErrorMessage } from '../../services/connectivity';
import {
  notificationActionAccessibility,
  notificationBannerState,
  notificationInboxBelongsToIdentity,
  notificationMutationCompletionBelongsToIdentity,
  notificationReadFailure,
  runNotificationActions,
  type NotificationInboxOwner,
} from '../../services/notification-action';
import { apiErrorMessage } from '../../services/api-error';
import { StatePanel } from '../../components/common/StatePanel';
import { Ionicons } from '@expo/vector-icons';
import { useAnimatedRouteTop } from '../../hooks/useAnimatedRouteTop';
import { paginationActionState } from '../../components/common/pagination-action';
import { appendUniquePageById } from '../../services/list-reconciliation';
import { pushPermissionAction, type PushPermissionState } from './notification-permission-state';

export function NotificationsScreen() {
  const { user } = useAuth();
  const offline = useKnownOffline();
  const listRef = useRef<FlatList<MemberNotification>>(null);
  useAnimatedRouteTop(listRef);
  const [items, setItems] = useState<MemberNotification[]>([]);
  const [itemsOwner, setItemsOwner] = useState<NotificationInboxOwner | null>(() => ({
    churchId: user?.churchId,
    memberId: user?.memberId,
  }));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedPage, setLoadedPage] = useState(0);
  const [totalItems, setTotalItems] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionNeedsRefresh, setActionNeedsRefresh] = useState(false);
  const [permission, setPermission] = useState<PushPermissionState | null>(null);
  const [permissionCheckFailed, setPermissionCheckFailed] = useState(false);
  const [enablingPush, setEnablingPush] = useState(false);
  const [markingIds, setMarkingIds] = useState<Set<string>>(() => new Set());
  const permissionLock = useRef(createSubmissionLock());
  const readLock = useRef(createKeyedSubmissionLock());
  const loadGate = useRef(createLatestRequestGate());
  const permissionCheckGate = useRef(createLatestRequestGate());
  const mountedRef = useRef(true);
  const activeIdentityRef = useRef<NotificationInboxOwner>({ churchId: user?.churchId, memberId: user?.memberId });
  const itemsOwnerRef = useRef(itemsOwner);
  const activeItemIdsRef = useRef(new Set<string>());
  activeIdentityRef.current = { churchId: user?.churchId, memberId: user?.memberId };
  itemsOwnerRef.current = itemsOwner;
  activeItemIdsRef.current = new Set(items.map((item) => item.id));
  const pushSupported = supportsNativePush(Platform.OS);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const ownsActiveIdentity = (churchId: string, memberId: string) => (
    notificationMutationCompletionBelongsToIdentity(
      mountedRef.current,
      activeIdentityRef.current,
      churchId,
      memberId,
    )
  );

  const load = useCallback(async (refresh = false, page = 1) => {
    const request = loadGate.current.begin();
    const startedOwner = { churchId: user?.churchId, memberId: user?.memberId };
    if (!notificationInboxBelongsToIdentity(itemsOwnerRef.current, startedOwner)) {
      itemsOwnerRef.current = startedOwner;
      setItemsOwner(startedOwner);
      setItems([]);
      setLoadedPage(0);
      setTotalItems(0);
      setActionError('');
      setActionNeedsRefresh(false);
      setMarkingIds(new Set());
      readLock.current = createKeyedSubmissionLock();
      permissionLock.current = createSubmissionLock();
      setEnablingPush(false);
    }
    if (page > 1) setLoadingMore(true);
    else if (refresh) setRefreshing(true);
    else setLoading(true);
    setLoadError('');
    try {
      if (!user?.churchId || !user.memberId) throw new Error('Member identity is incomplete');
      const result = await notificationService.listPage(
        user.churchId,
        user.memberId,
        page,
        NOTIFICATION_PAGE_SIZE,
      );
      if (loadGate.current.isLatest(request)) {
        setItems((current) => page === 1 ? result.items : appendUniquePageById(current, result.items));
        setLoadedPage(page);
        setTotalItems(result.total);
        const loadedOwner = { churchId: user.churchId, memberId: user.memberId };
        itemsOwnerRef.current = loadedOwner;
        setItemsOwner(loadedOwner);
        setActionError('');
        setActionNeedsRefresh(false);
      }
    } catch (cause) {
      if (loadGate.current.isLatest(request)) {
        setLoadError(connectivityErrorMessage(cause, 'Notifications are unavailable right now.'));
      }
    } finally {
      if (loadGate.current.isLatest(request)) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [user?.churchId, user?.memberId]);

  const checkPushPermission = useCallback(async () => {
    if (!pushSupported) return;
    const request = permissionCheckGate.current.begin();
    setPermissionCheckFailed(false);
    setPermission(null);
    try {
      const result = await Notifications.getPermissionsAsync();
      if (mountedRef.current && permissionCheckGate.current.isLatest(request)) {
        setPermission({
          status: result.status,
          canAskAgain: result.canAskAgain !== false,
        });
      }
    } catch {
      if (mountedRef.current && permissionCheckGate.current.isLatest(request)) {
        setPermissionCheckFailed(true);
      }
    }
  }, [pushSupported]);

  useEffect(() => {
    const gate = loadGate.current;
    const permissionGate = permissionCheckGate.current;
    void load();
    void checkPushPermission();
    return () => {
      gate.invalidate();
      permissionGate.invalidate();
    };
  }, [checkPushPermission, load]);

  useEffect(() => {
    if (!pushSupported) return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void checkPushPermission();
    });
    return () => subscription.remove();
  }, [checkPushPermission, pushSupported]);

  const enablePush = async () => {
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.memberId;
    if (!startedChurchId || !startedMemberId
      || !ownsActiveIdentity(startedChurchId, startedMemberId)) return;
    const actionLock = permissionLock.current;
    if (!actionLock.acquire()) return;
    setEnablingPush(true);
    setActionError('');
    try {
      const result = await notificationService.enablePush(
        Platform.OS,
        () => ownsActiveIdentity(startedChurchId, startedMemberId),
      );
      if (!ownsActiveIdentity(startedChurchId, startedMemberId)) return;
      setPermission(result);
      setPermissionCheckFailed(false);
      if (result.status !== 'granted') {
        setActionError('Notifications are off. You can enable them later in device settings.');
      }
    } catch (cause) {
      if (ownsActiveIdentity(startedChurchId, startedMemberId)) {
        setActionError(apiErrorMessage(cause, 'This device could not be registered for push alerts.'));
      }
    } finally {
      actionLock.release();
      if (ownsActiveIdentity(startedChurchId, startedMemberId)) setEnablingPush(false);
    }
  };

  const openNotificationSettings = async () => {
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.memberId;
    if (!startedChurchId || !startedMemberId
      || !ownsActiveIdentity(startedChurchId, startedMemberId)) return;
    const actionLock = permissionLock.current;
    if (!actionLock.acquire()) return;
    setEnablingPush(true);
    setActionError('');
    try {
      await Linking.openSettings();
    } catch {
      if (ownsActiveIdentity(startedChurchId, startedMemberId)) {
        setActionError('Device notification settings could not be opened.');
      }
    } finally {
      actionLock.release();
      if (ownsActiveIdentity(startedChurchId, startedMemberId)) setEnablingPush(false);
    }
  };

  const markRead = async (item: MemberNotification) => {
    const actionLock = readLock.current;
    if (!actionLock.acquire(item.id)) return;
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.memberId;
    if (!startedChurchId || !startedMemberId
      || !ownsActiveIdentity(startedChurchId, startedMemberId)
      || !notificationInboxBelongsToIdentity(itemsOwnerRef.current, activeIdentityRef.current)
      || !activeItemIdsRef.current.has(item.id)) {
      actionLock.release(item.id);
      return;
    }
    setActionError('');
    setMarkingIds((current) => new Set(current).add(item.id));
    try {
      const shouldMarkRead = !item.readAt && !offline;
      const optimisticReadAt = shouldMarkRead ? new Date().toISOString() : undefined;
      if (optimisticReadAt) {
        setItems((current) => current.map((value) => value.id === item.id ? { ...value, readAt: optimisticReadAt } : value));
      }
      const url = safeNotificationUrl(item.deepLink);
      const result = await runNotificationActions(
        shouldMarkRead ? () => notificationService.markRead(item.id) : undefined,
        url ? () => Linking.openURL(url) : undefined,
      );
      if (!ownsActiveIdentity(startedChurchId, startedMemberId)
        || !activeItemIdsRef.current.has(item.id)) return;
      const errors: string[] = [];
      if (optimisticReadAt) {
        if (!result.readFailed) {
          setItems((current) => current.map((value) => value.id === item.id && !value.readAt
            ? { ...value, readAt: optimisticReadAt }
            : value));
        } else {
          const failure = notificationReadFailure(result.readError);
          if (failure.outcomeUnknown) {
            setActionNeedsRefresh(true);
          } else {
            setItems((current) => current.map((value) => value.id === item.id ? {
              ...value,
              readAt: rollbackNotificationReadAt(value.readAt, optimisticReadAt, item.readAt),
            } : value));
          }
          errors.push(failure.message);
        }
      }
      if (result.openFailed) errors.push('The related screen could not be opened.');
      if (errors.length) setActionError(errors.join(' '));
    } finally {
      actionLock.release(item.id);
      if (ownsActiveIdentity(startedChurchId, startedMemberId)
        && activeItemIdsRef.current.has(item.id)) {
        setMarkingIds((current) => {
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
      }
    }
  };

  const ownsItems = notificationInboxBelongsToIdentity(itemsOwner, activeIdentityRef.current);
  const visibleItems = ownsItems ? items : [];
  const hasOlderItems = visibleItems.length < totalItems;
  const paginationAction = paginationActionState('older notifications', {
    offline,
    loading: loadingMore,
    refreshing,
    requiresRefresh: actionNeedsRefresh || Boolean(loadError),
  });
  const permissionAction = pushPermissionAction(permission, permissionCheckFailed);
  const banner = notificationBannerState(
    actionError,
    visibleItems.length > 0 ? loadError : '',
    actionNeedsRefresh,
    offline,
  );

  if (loading || (!ownsItems && !loadError)) return <ScreenSkeleton cards={4} />;

  return (
    <FlatList
      ref={listRef}
      style={styles.container}
      data={visibleItems}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { if (!offline) void load(true); }} enabled={!offline} tintColor={colors.primary} />}
      contentContainerStyle={styles.content}
      ListHeaderComponent={(
        <>
          {!pushSupported ? (
            <Card style={styles.permissionCard}>
              <View style={styles.permissionHeader}><View style={styles.permissionIcon}><Ionicons name="phone-portrait-outline" size={21} color={colors.primaryDark} /></View><View style={styles.permissionCopy}><Text style={styles.permissionEyebrow}>ON YOUR PHONE</Text><Text style={styles.permissionTitle}>Push alerts</Text></View></View>
              <Text style={styles.permissionBody}>Install ALTAR OS on iOS or Android to receive event reminders, pastoral messages, and giving receipts.</Text>
            </Card>
          ) : permissionAction !== 'enabled' ? (
            <Card style={styles.permissionCard}>
              <View style={styles.permissionHeader}><View style={styles.permissionIcon}><Ionicons name="notifications-outline" size={21} color={colors.primaryDark} /></View><View style={styles.permissionCopy}><Text style={styles.permissionEyebrow}>TIMELY, NOT NOISY</Text><Text style={styles.permissionTitle}>Stay in step with your church</Text></View></View>
              <Text style={styles.permissionBody}>{permissionAction === 'retry'
                ? 'Notification access could not be checked. Try the device check again.'
                : 'Enable push alerts for event reminders, pastoral messages, and giving receipts.'}</Text>
              <TouchableOpacity
                style={[styles.textAction, ((offline && permissionAction === 'prompt') || enablingPush || permissionAction === 'checking') && styles.actionDisabled]}
                onPress={() => {
                  if (permissionAction === 'settings') void openNotificationSettings();
                  else if (permissionAction === 'retry') void checkPushPermission();
                  else void enablePush();
                }}
                disabled={(offline && permissionAction === 'prompt') || enablingPush || permissionAction === 'checking'}
                accessibilityRole="button"
                accessibilityHint={permissionAction === 'settings'
                  ? 'Opens this app’s notification permissions in device settings.'
                  : permissionAction === 'retry' ? 'Checks this device’s notification permission again.'
                  : offline ? 'Reconnect to register this device for push alerts.' : undefined}
                accessibilityState={{ disabled: (offline && permissionAction === 'prompt') || enablingPush || permissionAction === 'checking', busy: enablingPush || permissionAction === 'checking' }}
              >
                <Text style={styles.enable}>{enablingPush
                  ? permissionAction === 'settings' ? 'Opening settings…' : 'Enabling notifications…'
                  : permissionAction === 'settings' ? 'Open device settings'
                    : permissionAction === 'retry' ? 'Retry notification check'
                      : permissionAction === 'checking' ? 'Checking notification access…' : 'Enable notifications'}</Text>
              </TouchableOpacity>
            </Card>
          ) : null}
          {banner ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText} accessibilityRole="alert">{banner.message}</Text>
              {banner.action ? (
                <TouchableOpacity
                  style={[styles.textAction, banner.action.disabled && styles.actionDisabled]}
                  onPress={() => void load(true)}
                  accessibilityRole="button"
                  accessibilityLabel={banner.action.label}
                  disabled={banner.action.disabled}
                  accessibilityState={{ disabled: banner.action.disabled }}
                  accessibilityHint={banner.action.hint}
                >
                  <Text style={styles.retry}>{banner.action.label}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </>
      )}
      renderItem={({ item }) => {
        const hasDestination = safeNotificationUrl(item.deepLink) !== null;
        const action = notificationActionAccessibility(
          hasDestination,
          Boolean(item.readAt),
          offline,
          markingIds.has(item.id),
        );
        return <TouchableOpacity
          onPress={() => void markRead(item)}
          activeOpacity={.8}
          disabled={action.disabled}
          accessibilityRole="button"
          accessibilityLabel={`${item.readAt ? '' : 'Unread notification. '}${item.title}. ${item.body}`}
          accessibilityHint={action.hint}
          accessibilityState={{ disabled: action.disabled, busy: action.busy }}
        >
          <Card style={[styles.item, !item.readAt && styles.unread, action.busy && styles.actionPending]}>
            <View style={styles.notificationRow}>
              <View style={[styles.notificationIcon, !item.readAt && styles.notificationIconUnread]}><Ionicons name="notifications-outline" size={19} color={item.readAt ? colors.muted : colors.primaryDark} accessible={false} /></View>
              <View style={styles.notificationCopy}>
                <View style={styles.itemHeader}><Text style={styles.title}>{item.title}</Text>{!item.readAt ? <View style={styles.dot} /> : null}</View>
                <Text style={styles.body}>{item.body}</Text>
                <Text style={styles.date}>{new Date(item.createdAt).toLocaleString('en-GH', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Text>
              </View>
            </View>
          </Card>
        </TouchableOpacity>;
      }}
      ListEmptyComponent={(
        <StatePanel
          icon={loadError ? (offline ? 'cloud-offline-outline' : 'notifications-off-outline') : 'checkmark-done-outline'}
          tone={loadError ? (offline ? 'offline' : 'error') : 'quiet'}
          title={loadError ? (offline ? 'Your inbox is offline' : 'Inbox unavailable') : 'You are all caught up'}
          message={loadError || 'New messages, reminders, and giving receipts from your church will appear here.'}
          actionLabel={loadError ? (offline ? 'Reconnect to retry' : 'Try again') : undefined}
          actionHint={offline ? 'Reconnect to load notifications.' : 'Loads notifications again.'}
          actionDisabled={offline}
          onAction={loadError ? () => void load() : undefined}
        />
      )}
      ListFooterComponent={visibleItems.length > 0 ? (
        <View style={styles.footer}>
          {hasOlderItems ? (
            <TouchableOpacity
              style={[styles.loadMore, paginationAction.disabled && styles.actionDisabled]}
              onPress={() => void load(false, loadedPage + 1)}
              disabled={paginationAction.disabled}
              accessibilityRole="button"
              accessibilityLabel={paginationAction.label}
              accessibilityHint={paginationAction.hint}
              accessibilityState={{ disabled: paginationAction.disabled, busy: paginationAction.busy }}
            >
              <Text style={styles.loadMoreText}>{paginationAction.label}</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.endText}>You’ve reached the beginning of your notification history.</Text>
          )}
        </View>
      ) : null}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: spacing.base, flexGrow: 1 },
  permissionCard: { backgroundColor: colors.secondaryLight, borderColor: '#CBE8E0', borderRadius: borderRadius['2xl'], marginBottom: spacing.xl },
  permissionHeader: { flexDirection: 'row', alignItems: 'center' },
  permissionIcon: { width: 44, height: 44, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(109,213,196,.28)', marginRight: spacing.md },
  permissionCopy: { flex: 1 },
  permissionEyebrow: { color: colors.primary, fontFamily: typography.families.bold, fontSize: 9, letterSpacing: 1.05, marginBottom: 2 },
  permissionTitle: { color: colors.text, fontFamily: typography.families.bold, fontSize: typography.sizes.lg },
  permissionBody: { color: colors.textSecondary, fontSize: typography.sizes.md, lineHeight: 20, marginTop: spacing.sm },
  enable: { color: colors.primaryDark, fontFamily: typography.families.semibold, fontSize: typography.sizes.md, marginTop: spacing.md },
  textAction: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  actionDisabled: { opacity: 0.5 },
  actionPending: { opacity: 0.62 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, backgroundColor: '#FFF7F5', padding: spacing.md, marginBottom: spacing.md },
  errorText: { color: colors.error, fontSize: typography.sizes.sm, lineHeight: 19, flex: 1 },
  retry: { color: colors.primary, fontFamily: typography.families.semibold, fontSize: typography.sizes.sm, paddingVertical: spacing.xs },
  item: { marginBottom: spacing.md, borderRadius: borderRadius.xl },
  unread: { borderLeftWidth: 4, borderLeftColor: colors.primary },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  notificationRow: { flexDirection: 'row', alignItems: 'flex-start' },
  notificationIcon: { width: 40, height: 40, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted, marginRight: spacing.md },
  notificationIconUnread: { backgroundColor: colors.secondaryLight },
  notificationCopy: { flex: 1 },
  title: { color: colors.text, fontFamily: typography.families.semibold, fontSize: typography.sizes.base, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginLeft: spacing.sm },
  body: { color: colors.textSecondary, fontSize: typography.sizes.md, lineHeight: 20, marginTop: spacing.sm },
  date: { color: colors.muted, fontSize: typography.sizes.xs, marginTop: spacing.md },
  footer: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.xl },
  loadMore: { minHeight: 48, minWidth: 230, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primary, borderRadius: borderRadius.full, paddingHorizontal: spacing.xl },
  loadMoreText: { color: colors.primaryDark, fontFamily: typography.families.semibold, fontSize: typography.sizes.sm },
  endText: { color: colors.muted, fontFamily: typography.families.medium, fontSize: typography.sizes.sm, textAlign: 'center' },
});
