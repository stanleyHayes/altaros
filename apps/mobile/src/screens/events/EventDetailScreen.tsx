import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { Avatar } from '../../components/common/Avatar';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';
import type { ChurchEvent } from '../../services/event.service';
import eventService from '../../services/event.service';

type EventDetailRoute = RouteProp<RootStackParamList, 'EventDetail'>;

export function EventDetailScreen() {
  const route = useRoute<EventDetailRoute>();
  const { eventId } = route.params;

  const [event, setEvent] = useState<ChurchEvent | null>(null);
  const [attendees, setAttendees] = useState<{ id: string; name: string; avatar?: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadEvent = async () => {
      try {
        const [eventResult, attendeeResult] = await Promise.all([
          eventService.getEvent(eventId),
          eventService.getAttendees(eventId).catch(() => []),
        ]);
        setEvent(eventResult);
        setAttendees(attendeeResult);
      } catch {
        setEvent(null);
      } finally {
        setIsLoading(false);
      }
    };
    loadEvent();
  }, [eventId]);

  const handleRsvp = async () => {
    if (!event) return;
    try {
      const response = event.isRsvped
        ? await eventService.cancelRsvp(event.id)
        : await eventService.rsvp(event.id);
      setEvent({ ...event, isRsvped: response.status === 'confirmed', attendeeCount: response.attendeeCount });
      Alert.alert(response.status === 'confirmed' ? 'You are going' : 'RSVP cancelled', response.status === 'confirmed' ? 'This event is now on your list.' : 'You are no longer marked as attending.');
    } catch {
      Alert.alert('RSVP not updated', 'Check your connection and try again.');
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

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.loading}>
        <Text style={styles.emptyText}>Event not found.</Text>
      </View>
    );
  }

  const start = formatDateTime(event.startDate);
  const end = formatDateTime(event.endDate);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryText}>{event.category}</Text>
        </View>
        <Text style={styles.title}>{event.title}</Text>
        <Text style={styles.organizer}>Organized by {event.organizer}</Text>
      </View>

      {/* Details */}
      <View style={styles.details}>
        <Card style={styles.detailCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailIcon}>{'\u2315'}</Text>
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
            <Text style={styles.detailIcon}>{'\u2302'}</Text>
            <View style={styles.detailInfo}>
              <Text style={styles.detailLabel}>Location</Text>
              <Text style={styles.detailValue}>{event.location}</Text>
              {event.address && (
                <Text style={styles.detailSub}>{event.address}</Text>
              )}
            </View>
          </View>
        </Card>

        {/* Map Placeholder */}
        <View style={styles.mapPlaceholder}>
          <Text style={styles.mapPlaceholderText}>Map View</Text>
          <Text style={styles.mapPlaceholderSub}>
            {/* TODO: Integrate with react-native-maps */}
            Map will be displayed here
          </Text>
        </View>
      </View>

      {/* Description */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About This Event</Text>
        <Text style={styles.description}>{event.description}</Text>
      </View>

      {/* Attendees */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Attendees ({event.attendeeCount})
        </Text>
        <View style={styles.attendeesList}>
          {attendees.map((attendee) => (
            <View key={attendee.id} style={styles.attendeeItem}>
              <Avatar name={attendee.name} uri={attendee.avatar} size="sm" />
              <Text style={styles.attendeeName}>{attendee.name}</Text>
            </View>
          ))}
          {event.attendeeCount > attendees.length && (
            <Text style={styles.moreAttendees}>
              +{event.attendeeCount - attendees.length} more
            </Text>
          )}
        </View>
      </View>

      {/* RSVP Button */}
      <View style={styles.rsvpSection}>
        <Button
          title={event.isRsvped ? 'Cancel RSVP' : 'RSVP to This Event'}
          variant={event.isRsvped ? 'outline' : 'primary'}
          onPress={() => void handleRsvp()}
          fullWidth
          size="lg"
        />
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
  },
  emptyText: {
    fontSize: typography.sizes.base,
    color: colors.muted,
  },
  header: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing['2xl'],
  },
  categoryBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
  },
  categoryText: {
    fontSize: typography.sizes.sm,
    color: '#FFFFFF',
    fontWeight: typography.weights.medium,
    textTransform: 'capitalize',
  },
  title: {
    fontSize: typography.sizes['2xl'],
    fontWeight: typography.weights.bold,
    color: '#FFFFFF',
    marginBottom: spacing.sm,
  },
  organizer: {
    fontSize: typography.sizes.md,
    color: 'rgba(255,255,255,0.8)',
  },
  details: {
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
    fontSize: 20,
    color: colors.primary,
    marginRight: spacing.md,
    marginTop: 2,
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
    fontWeight: typography.weights.semibold,
    color: colors.text,
  },
  detailSub: {
    fontSize: typography.sizes.md,
    color: colors.textSecondary,
    marginTop: 2,
  },
  mapPlaceholder: {
    height: 160,
    backgroundColor: colors.divider,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPlaceholderText: {
    fontSize: typography.sizes.base,
    color: colors.muted,
    fontWeight: typography.weights.medium,
  },
  mapPlaceholderSub: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  section: {
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  description: {
    fontSize: typography.sizes.base,
    color: colors.textSecondary,
    lineHeight: 24,
  },
  attendeesList: {
    gap: spacing.md,
  },
  attendeeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  attendeeName: {
    fontSize: typography.sizes.md,
    color: colors.text,
  },
  moreAttendees: {
    fontSize: typography.sizes.md,
    color: colors.primary,
    fontWeight: typography.weights.medium,
    marginTop: spacing.xs,
  },
  rsvpSection: {
    padding: spacing.xl,
    paddingBottom: spacing['3xl'],
  },
});
