import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';
import type { ChurchEvent } from '../../services/event.service';
import eventService, { eventRsvpAvailability } from '../../services/event.service';
import { useAuth } from '../../hooks/useAuth';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import { ScreenSkeleton } from '../../components/common/ScreenSkeleton';
import { StatePanel } from '../../components/common/StatePanel';
import { createSubmissionLock } from '../../services/submission-lock';
import { createLatestRequestGate } from '../../services/latest-request';
import { reconcileToggleCount } from '../../services/list-reconciliation';
import { eventListBelongsToIdentity, type EventMemberContext } from './event-screen-state';
import { useAnimatedRouteTop } from '../../hooks/useAnimatedRouteTop';

type EventsNav = NativeStackNavigationProp<RootStackParamList>;

export function EventsScreen() {
  const navigation = useNavigation<EventsNav>();
  const { user } = useAuth();
  const offline = useKnownOffline();
  const [events, setEvents] = useState<ChurchEvent[]>([]);
  const [eventsOwner, setEventsOwner] = useState<EventMemberContext | null>(() => ({
    churchId: user?.churchId,
    memberId: user?.id,
  }));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [rsvpWarning, setRsvpWarning] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const rsvpLock = useRef(createSubmissionLock());
  const loadGate = useRef(createLatestRequestGate());
  const listRef = useRef<FlatList<ChurchEvent>>(null);
  useAnimatedRouteTop(listRef);
  const mountedRef = useRef(true);
  const activeIdentityRef = useRef<EventMemberContext>({ churchId: user?.churchId, memberId: user?.id });
  const eventsOwnerRef = useRef(eventsOwner);
  const activeEventIdsRef = useRef(new Set<string>());
  activeIdentityRef.current = { churchId: user?.churchId, memberId: user?.id };
  eventsOwnerRef.current = eventsOwner;
  activeEventIdsRef.current = new Set(events.map((event) => event.id));

  const loadEvents = useCallback(async (refresh = false) => {
      const request = loadGate.current.begin();
      const startedOwner = { churchId: user?.churchId, memberId: user?.id };
      if (!eventListBelongsToIdentity(eventsOwnerRef.current, startedOwner)) {
        eventsOwnerRef.current = startedOwner;
        setEventsOwner(startedOwner);
        setEvents([]);
        setRsvpWarning('');
        setUpdatingId(null);
        rsvpLock.current.release();
      }
      if (refresh) setIsRefreshing(true);
      else setIsLoading(true);
      try {
        setError('');
        if (!user?.churchId) throw new Error('No church selected');
        if (!user.id) throw new Error('Member identity is incomplete');
        const result = await eventService.getEvents(user.churchId, user.id, { upcoming: true, limit: 50 });
        if (loadGate.current.isLatest(request)) {
          setEvents(result.events);
          const loadedOwner = { churchId: user.churchId, memberId: user.id };
          eventsOwnerRef.current = loadedOwner;
          setEventsOwner(loadedOwner);
          setRsvpWarning(result.events.some((event) => !event.rsvpStatusKnown)
            ? 'Your attendance status is temporarily unavailable. Refresh before updating an RSVP.'
            : '');
        }
      } catch {
        if (loadGate.current.isLatest(request)) {
          setError('We could not load upcoming events.');
          setRsvpWarning('');
        }
      } finally {
        if (loadGate.current.isLatest(request)) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
  }, [user?.churchId, user?.id]);

  useEffect(() => {
    mountedRef.current = true;
    const gate = loadGate.current;
    void loadEvents();
    return () => { mountedRef.current = false; gate.invalidate(); };
  }, [loadEvents]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return {
      day: date.toLocaleDateString('en-US', { day: 'numeric' }),
      month: date.toLocaleDateString('en-US', { month: 'short' }),
      time: date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      }),
    };
  };

  const handleRsvp = async (event: ChurchEvent) => {
    if (!event.rsvpStatusKnown) return;
    if (!rsvpLock.current.acquire()) return;
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.id;
    if (!startedChurchId || !startedMemberId
      || !mountedRef.current
      || !eventListBelongsToIdentity(eventsOwnerRef.current, activeIdentityRef.current)
      || !activeEventIdsRef.current.has(event.id)) {
      rsvpLock.current.release();
      return;
    }
    try {
      setUpdatingId(event.id);
      setError('');
      const response = event.isRsvped
        ? await eventService.cancelRsvp(event.id, startedMemberId)
        : await eventService.rsvp(event.id, startedMemberId);
      if (!mountedRef.current
        || activeIdentityRef.current.churchId !== startedChurchId
        || activeIdentityRef.current.memberId !== startedMemberId
        || !activeEventIdsRef.current.has(event.id)) return;
      setEvents((current) => current.map((item) => {
        if (item.id !== event.id) return item;
        const reconciled = reconcileToggleCount(
          { selected: item.isRsvped, count: item.attendeeCount },
          response.status === 'confirmed',
          response.attendeeCount,
        );
        return {
          ...item,
          isRsvped: reconciled.selected,
          rsvpStatusKnown: true,
          attendeeCount: reconciled.count,
        };
      }));
    } catch {
      if (mountedRef.current
        && activeIdentityRef.current.churchId === startedChurchId
        && activeIdentityRef.current.memberId === startedMemberId
        && activeEventIdsRef.current.has(event.id)) {
        setError('We could not update that RSVP. Try again.');
      }
    } finally {
      rsvpLock.current.release();
      if (mountedRef.current) setUpdatingId(null);
    }
  };

  const renderEvent = ({ item }: { item: ChurchEvent }) => {
    const { day, month, time } = formatDate(item.startDate);
    const availability = eventRsvpAvailability(item);

    return (
      <Card style={styles.eventCard}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => navigation.navigate('EventDetail', { eventId: item.id })}
          accessibilityRole="button"
          accessibilityLabel={`${item.title}, ${month} ${day} at ${time}, ${item.location}`}
          accessibilityHint="Opens event details"
        >
          <View style={styles.eventRow}>
            {/* Date Badge */}
            <View style={styles.dateBadge}>
              <Text style={styles.dateMonth}>{month}</Text>
              <Text style={styles.dateDay}>{day}</Text>
            </View>

            {/* Event Info */}
            <View style={styles.eventInfo}>
              <Text style={styles.eventTitle}>{item.title}</Text>
              <Text style={styles.eventMeta}>
                {time} {'\u2022'} {item.location}
              </Text>
              <Text style={styles.attendeeCount}>
                {item.attendeeCount} attending
                {item.maxAttendees
                  ? ` / ${item.maxAttendees} max`
                  : ''}
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* RSVP is deliberately outside the detail navigation target so one
            tap cannot both mutate attendance and open another screen. */}
        <View style={styles.rsvpRow}>
          <Button
            title={availability.label}
            variant={item.isRsvped ? 'outline' : 'primary'}
            size="sm"
            onPress={() => void handleRsvp(item)}
            loading={updatingId === item.id}
            disabled={offline || !availability.allowed || (updatingId !== null && updatingId !== item.id)}
            accessibilityLabel={item.isRsvped ? `Cancel RSVP for ${item.title}` : `RSVP for ${item.title}`}
            accessibilityHint={offline ? 'Reconnect to update your RSVP.' : availability.reason}
          />
          {availability.reason ? <Text style={styles.rsvpReason}>{availability.reason}</Text> : null}
        </View>
      </Card>
    );
  };

  const ownsEvents = eventListBelongsToIdentity(eventsOwner, activeIdentityRef.current);
  const visibleEvents = ownsEvents ? events : [];

  if (isLoading || !ownsEvents) {
    return <ScreenSkeleton cards={4} />;
  }

  return (
    <FlatList
      ref={listRef}
      style={styles.container}
      data={visibleEvents}
      keyExtractor={(item) => item.id}
      renderItem={renderEvent}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => { if (!offline) void loadEvents(true); }} enabled={!offline} tintColor={colors.primary} />}
      ListHeaderComponent={(error && visibleEvents.length) || rsvpWarning ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText} accessibilityRole="alert">{error || rsvpWarning}</Text>
          <TouchableOpacity onPress={() => void loadEvents(true)} accessibilityRole="button" disabled={offline} accessibilityState={{ disabled: offline }} accessibilityHint={offline ? 'Reconnect to refresh upcoming events.' : undefined} style={offline && { opacity: 0.5 }}>
            <Text style={styles.retry}>{offline ? 'Reconnect to retry' : 'Try again'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      ListEmptyComponent={
        <StatePanel
          icon={error ? (offline ? 'cloud-offline-outline' : 'calendar-outline') : 'calendar-clear-outline'}
          tone={error ? (offline ? 'offline' : 'error') : 'quiet'}
          title={error ? (offline ? 'Events need a connection' : 'Events are taking a pause') : 'Nothing on the calendar yet'}
          message={error || 'When your church publishes its next gathering, every detail will be waiting here.'}
          actionLabel={error ? (offline ? 'Reconnect to retry' : 'Try again') : undefined}
          actionHint={offline ? 'Reconnect to load upcoming events.' : 'Loads upcoming events again.'}
          actionDisabled={offline}
          onAction={error ? () => void loadEvents() : undefined}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  list: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    padding: spacing.xl,
    flexGrow: 1,
  },
  eventCard: {
    marginBottom: spacing.md,
  },
  eventRow: {
    flexDirection: 'row',
  },
  dateBadge: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primaryLight + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  dateMonth: {
    fontSize: typography.sizes.xs,
    fontFamily: typography.families.semibold,
    color: colors.primary,
    textTransform: 'uppercase',
  },
  dateDay: {
    fontSize: typography.sizes.xl,
    fontFamily: typography.families.bold,
    color: colors.primary,
  },
  eventInfo: {
    flex: 1,
  },
  eventTitle: {
    fontSize: typography.sizes.base,
    fontFamily: typography.families.semibold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  eventMeta: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
  },
  attendeeCount: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
    marginTop: 2,
  },
  rsvpRow: {
    marginTop: spacing.md,
    alignItems: 'flex-end',
  },
  rsvpReason: { color: colors.muted, fontSize: typography.sizes.xs, marginTop: spacing.xs, textAlign: 'right' },
  errorBanner: {
    backgroundColor: `${colors.error}12`,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { color: colors.error, fontSize: typography.sizes.sm },
  retry: { color: colors.primary, fontSize: typography.sizes.sm, fontFamily: typography.families.semibold, marginTop: spacing.xs },
});
