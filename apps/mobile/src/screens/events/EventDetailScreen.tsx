import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Alert,
  Linking,
  TouchableOpacity,
} from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';
import type { ChurchEvent } from '../../services/event.service';
import eventService, { eventMapAction, eventRsvpAvailability } from '../../services/event.service';
import { useAuth } from '../../hooks/useAuth';
import { ScreenSkeleton } from '../../components/common/ScreenSkeleton';
import { httpStatus } from '../../services/api-error';
import { createSubmissionLock } from '../../services/submission-lock';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import { createLatestRequestGate } from '../../services/latest-request';
import { reconcileToggleCount } from '../../services/list-reconciliation';
import {
  eventActionCompletionBelongsToContext,
  eventDetailBelongsToContext,
  eventRsvpAction,
  eventRsvpFailure,
  type EventDetailContext,
} from './event-screen-state';
import { Ionicons } from '@expo/vector-icons';
import { StatePanel } from '../../components/common/StatePanel';
import { useAnimatedRouteTop } from '../../hooks/useAnimatedRouteTop';

type EventDetailRoute = RouteProp<RootStackParamList, 'EventDetail'>;

export function EventDetailScreen() {
  const route = useRoute<EventDetailRoute>();
  const { eventId } = route.params;
  const { user } = useAuth();
  const offline = useKnownOffline();
  const scrollRef = useRef<ScrollView>(null);
  useAnimatedRouteTop(scrollRef);

  const [event, setEvent] = useState<ChurchEvent | null>(null);
  const [eventOwner, setEventOwner] = useState<EventDetailContext | null>(() => ({
    eventId,
    churchId: user?.churchId,
    memberId: user?.memberId,
  }));
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isOpeningMap, setIsOpeningMap] = useState(false);
  const [loadError, setLoadError] = useState<'not_found' | 'unavailable' | null>(null);
  const rsvpLock = useRef(createSubmissionLock());
  const mapLock = useRef(createSubmissionLock());
  const loadGate = useRef(createLatestRequestGate());
  const mountedRef = useRef(true);
  const activeContextRef = useRef<EventDetailContext>({ eventId, churchId: user?.churchId, memberId: user?.memberId });
  const offlineRef = useRef(offline);
  activeContextRef.current = { eventId, churchId: user?.churchId, memberId: user?.memberId };
  offlineRef.current = offline;

  const loadEvent = useCallback(async () => {
    const request = loadGate.current.begin();
    const startedContext = { eventId, churchId: user?.churchId, memberId: user?.memberId };
    setEventOwner(startedContext);
    setEvent(null);
    setIsUpdating(false);
    setIsOpeningMap(false);
    // Route reuse gets fresh locks. In-flight handlers retain and release only
    // their captured lock, so an old finalizer cannot unlock a replacement
    // event action.
    rsvpLock.current = createSubmissionLock();
    mapLock.current = createSubmissionLock();
    setIsLoading(true);
    setLoadError(null);
    try {
      if (!user?.churchId || !user.memberId) throw new Error('Member identity is incomplete');
      const eventResult = await eventService.getEvent(eventId, user.churchId, user.memberId);
      if (loadGate.current.isLatest(request)) {
        setEventOwner(startedContext);
        setEvent(eventResult);
      }
    } catch (error) {
      if (loadGate.current.isLatest(request)) {
        setEvent(null);
        setLoadError(httpStatus(error) === 404 ? 'not_found' : 'unavailable');
      }
    } finally {
      if (loadGate.current.isLatest(request)) setIsLoading(false);
    }
  }, [eventId, user?.churchId, user?.memberId]);

  useEffect(() => {
    mountedRef.current = true;
    const gate = loadGate.current;
    void loadEvent();
    return () => {
      mountedRef.current = false;
      gate.invalidate();
    };
  }, [loadEvent]);

  const handleRsvp = async () => {
    const actionLock = rsvpLock.current;
    if (offline || !event || !event.rsvpStatusKnown || !user?.memberId || !user.churchId || !actionLock.acquire()) return;
    const startedContext = { eventId: event.id, churchId: user.churchId, memberId: user.memberId };
    if (!eventDetailBelongsToContext(eventOwner, startedContext)
      || !eventDetailBelongsToContext(activeContextRef.current, startedContext)) {
      actionLock.release();
      return;
    }
    try {
      setIsUpdating(true);
      const response = event.isRsvped
        ? await eventService.cancelRsvp(event.id, user.memberId)
        : await eventService.rsvp(event.id, user.memberId);
      if (!eventActionCompletionBelongsToContext(
        mountedRef.current,
        activeContextRef.current,
        startedContext,
      )) return;
      setEvent((current) => {
        if (!current || current.id !== event.id) return current;
        const reconciled = reconcileToggleCount(
          { selected: current.isRsvped, count: current.attendeeCount },
          response.status === 'confirmed',
          response.attendeeCount,
        );
        return {
          ...current,
          isRsvped: reconciled.selected,
          rsvpStatusKnown: true,
          attendeeCount: reconciled.count,
        };
      });
      Alert.alert(response.status === 'confirmed' ? 'You are going' : 'RSVP cancelled', response.status === 'confirmed' ? 'This event is now on your list.' : 'You are no longer marked as attending.');
    } catch (cause) {
      if (eventActionCompletionBelongsToContext(
        mountedRef.current,
        activeContextRef.current,
        startedContext,
      )) {
        const failure = eventRsvpFailure(cause);
        if (failure.outcomeUnknown) {
          setEvent((current) => current && current.id === event.id
            ? { ...current, rsvpStatusKnown: false }
            : current);
        }
        Alert.alert(failure.outcomeUnknown ? 'RSVP status unknown' : 'RSVP not updated', failure.message);
      }
    } finally {
      actionLock.release();
      if (eventActionCompletionBelongsToContext(
        mountedRef.current,
        activeContextRef.current,
        startedContext,
      )) setIsUpdating(false);
    }
  };

  const openMaps = async () => {
    if (!event || !user?.churchId || !user.memberId) return;
    const startedContext = { eventId: event.id, churchId: user.churchId, memberId: user.memberId };
    if (!eventDetailBelongsToContext(eventOwner, startedContext)
      || !eventDetailBelongsToContext(activeContextRef.current, startedContext)) return;
    const action = eventMapAction(event.location, offline, isOpeningMap);
    const actionLock = mapLock.current;
    if (!action.url || action.disabled || !actionLock.acquire()) return;
    setIsOpeningMap(true);
    try {
      if (!(await Linking.canOpenURL(action.url))) throw new Error('unsupported map URL');
      if (!eventActionCompletionBelongsToContext(
        mountedRef.current,
        activeContextRef.current,
        startedContext,
      ) || offlineRef.current) return;
      await Linking.openURL(action.url);
    } catch {
      if (eventActionCompletionBelongsToContext(
        mountedRef.current,
        activeContextRef.current,
        startedContext,
      )) {
        Alert.alert('Maps unavailable', 'We could not open this location on your device.');
      }
    } finally {
      actionLock.release();
      if (eventActionCompletionBelongsToContext(
        mountedRef.current,
        activeContextRef.current,
        startedContext,
      )) setIsOpeningMap(false);
    }
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return {
      date: date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
      time: date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      }),
    };
  };

  const ownsEvent = eventDetailBelongsToContext(eventOwner, activeContextRef.current);

  if (isLoading || !ownsEvent) {
    return <ScreenSkeleton cards={3} />;
  }

  if (!event) {
    return (
      <View style={styles.loading}>
        <StatePanel
          icon={loadError === 'not_found' ? 'calendar-clear-outline' : offline ? 'cloud-offline-outline' : 'calendar-outline'}
          tone={loadError === 'not_found' ? 'quiet' : offline ? 'offline' : 'error'}
          title={loadError === 'not_found' ? 'This event has moved on' : offline ? 'Event details are offline' : 'Could not load this event'}
          message={loadError === 'not_found' ? 'Your church may have removed or rescheduled it.' : offline ? 'Reconnect to load the latest date, location, and RSVP status.' : 'Check your connection and try again.'}
          actionLabel={loadError === 'unavailable' ? (offline ? 'Reconnect to retry' : 'Try again') : undefined}
          actionHint={offline ? 'Reconnect to load this event.' : 'Loads this event again.'}
          actionDisabled={offline}
          onAction={loadError === 'unavailable' ? () => void loadEvent() : undefined}
        />
      </View>
    );
  }

  const start = formatDateTime(event.startDate);
  const end = formatDateTime(event.endDate);
  const availability = eventRsvpAvailability(event);
  const rsvpAction = eventRsvpAction(
    availability,
    event.isRsvped,
    offline,
    isUpdating,
    false,
    true,
  );
  const mapAction = eventMapAction(event.location, offline, isOpeningMap);

  return (
    <ScrollView ref={scrollRef} style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerOrb} accessible={false} />
        <View style={styles.headerRing} accessible={false} />
        <Text style={styles.headerEyebrow}>GATHER WITH YOUR CHURCH</Text>
        <Text style={styles.title}>{event.title}</Text>
        <Text style={styles.headerMeta}>{start.date} · {start.time}</Text>
      </View>

      {/* Details */}
      <View style={styles.details}>
        <Card style={styles.detailCard}>
          <View style={styles.detailRow}>
            <View style={styles.detailIcon}><Ionicons name="calendar-outline" size={20} color={colors.primaryDark} /></View>
            <View style={styles.detailInfo}>
              <Text style={styles.detailLabel}>Date & Time</Text>
              <Text style={styles.detailValue}>{start.date}</Text>
              <Text style={styles.detailSub}>
                {start.time} - {end.time}
              </Text>
            </View>
          </View>
        </Card>

        <Card style={styles.detailCard}>
          <View style={styles.detailRow}>
            <View style={styles.detailIcon}><Ionicons name="location-outline" size={20} color={colors.primaryDark} /></View>
            <View style={styles.detailInfo}>
              <Text style={styles.detailLabel}>Location</Text>
              <Text style={styles.detailValue}>{event.location}</Text>
            </View>
          </View>
        </Card>

        {mapAction.url ? (
          <TouchableOpacity
            style={[styles.mapAction, mapAction.disabled && styles.actionDisabled]}
            onPress={() => void openMaps()}
            disabled={mapAction.disabled}
            accessibilityRole="link"
            accessibilityLabel={mapAction.label}
            accessibilityHint={mapAction.hint}
            accessibilityState={{ disabled: mapAction.disabled, busy: mapAction.busy }}
          >
            <Text style={styles.mapActionTitle}>Open location in Maps</Text>
            <Text style={styles.mapActionSub}>{offline ? 'Reconnect to view this location' : isOpeningMap ? 'Opening Google Maps…' : 'View this location with Google Maps →'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Description */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About This Event</Text>
        <Text style={styles.description}>{event.description || 'Your church has not added more details for this event.'}</Text>
      </View>

      {/* Attendees */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Attendees ({event.attendeeCount})
        </Text>
        <Text style={styles.attendeePrivacy}>
          {event.attendeeCount === 0
            ? 'Be the first to let your church know you are coming.'
            : 'Attendee names stay private. Your church can use the count to prepare.'}
        </Text>
      </View>

      {/* RSVP Button */}
      <View style={styles.rsvpSection}>
        <Button
          title={rsvpAction.label}
          variant={event.isRsvped ? 'outline' : 'primary'}
          onPress={() => void handleRsvp()}
          fullWidth
          size="lg"
          loading={isUpdating}
          disabled={rsvpAction.disabled}
          accessibilityHint={rsvpAction.hint}
        />
        {offline ? <Text style={styles.rsvpReason}>Reconnect to update your RSVP.</Text>
          : availability.reason ? <Text style={styles.rsvpReason}>{availability.reason}</Text> : null}
        {event.rsvpStatusKnown === false ? (
          <TouchableOpacity
            style={styles.rsvpRefreshAction}
            onPress={() => void loadEvent()}
            disabled={offline || isLoading}
            accessibilityRole="button"
            accessibilityLabel="Refresh RSVP status"
            accessibilityHint={offline ? 'Reconnect to refresh your attendance status.' : 'Loads your latest attendance status before another RSVP change.'}
            accessibilityState={{ disabled: offline || isLoading, busy: isLoading }}
          >
            <Text style={[styles.rsvpRefresh, offline && styles.actionDisabled]}>Refresh RSVP status</Text>
          </TouchableOpacity>
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
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
  header: {
    backgroundColor: colors.text,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing['2xl'],
    overflow: 'hidden',
  },
  headerOrb: { position: 'absolute', width: 210, height: 210, borderRadius: 105, backgroundColor: '#174C45', top: -118, right: -50 },
  headerRing: { position: 'absolute', width: 124, height: 124, borderRadius: 62, borderWidth: 1, borderColor: 'rgba(109,213,196,.28)', top: -62, right: 20 },
  headerEyebrow: { color: colors.primaryLight, fontFamily: typography.families.bold, fontSize: typography.sizes.xs, letterSpacing: 1.35 },
  title: {
    fontSize: typography.sizes['3xl'],
    fontFamily: typography.families.bold,
    color: '#FFFFFF',
    letterSpacing: -.8,
    marginTop: spacing.lg,
  },
  headerMeta: { color: 'rgba(255,255,255,.65)', fontFamily: typography.families.medium, fontSize: typography.sizes.sm, marginTop: spacing.sm },
  details: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    padding: spacing.xl,
  },
  detailCard: {
    marginBottom: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  detailIcon: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondaryLight,
    marginRight: spacing.md,
  },
  detailInfo: {
    flex: 1,
  },
  detailLabel: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: typography.sizes.base,
    fontFamily: typography.families.semibold,
    color: colors.text,
  },
  detailSub: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    marginTop: 2,
  },
  mapAction: {
    backgroundColor: colors.secondaryLight,
    borderRadius: borderRadius.lg,
    padding: spacing.base,
  },
  actionDisabled: { opacity: 0.5 },
  mapActionTitle: {
    fontSize: typography.sizes.base,
    color: colors.primaryDark,
    fontFamily: typography.families.semibold,
  },
  mapActionSub: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  section: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.sizes.lg,
    fontFamily: typography.families.bold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  description: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    lineHeight: 24,
  },
  attendeePrivacy: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  rsvpSection: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    padding: spacing.xl,
    paddingBottom: spacing['3xl'],
  },
  rsvpReason: { color: colors.muted, fontSize: typography.sizes.sm, textAlign: 'center', marginTop: spacing.sm },
  rsvpRefreshAction: { minHeight: 44, justifyContent: 'center', marginTop: spacing.sm },
  rsvpRefresh: { color: colors.primary, fontFamily: typography.families.semibold, fontSize: typography.sizes.sm, textAlign: 'center' },
});
