import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../../components/common/Card';
import { Button } from '../../components/common/Button';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';
import type { ChurchEvent } from '../../services/event.service';

type EventsNav = NativeStackNavigationProp<RootStackParamList>;

// TODO: Replace with real API data
const mockEvents: ChurchEvent[] = [
  {
    id: '1',
    title: 'Sunday Worship Service',
    description: 'Join us for our weekly worship service with praise and the Word.',
    startDate: '2026-03-30T10:00:00Z',
    endDate: '2026-03-30T12:00:00Z',
    location: 'Main Sanctuary',
    category: 'worship',
    isRsvped: true,
    attendeeCount: 150,
    organizer: 'Worship Team',
  },
  {
    id: '2',
    title: 'Midweek Bible Study',
    description: 'Deep dive into the book of Romans. Bring your Bible and a friend!',
    startDate: '2026-04-01T19:00:00Z',
    endDate: '2026-04-01T20:30:00Z',
    location: 'Fellowship Hall',
    category: 'fellowship',
    isRsvped: false,
    attendeeCount: 35,
    organizer: 'Pastor James',
  },
  {
    id: '3',
    title: 'Youth Night',
    description: 'Games, worship, and a message for our young people.',
    startDate: '2026-04-04T18:00:00Z',
    endDate: '2026-04-04T20:00:00Z',
    location: 'Youth Center',
    category: 'youth',
    isRsvped: false,
    attendeeCount: 42,
    maxAttendees: 60,
    organizer: 'Youth Ministry',
  },
  {
    id: '4',
    title: 'Community Outreach Day',
    description: 'Serving our local community with food and supplies.',
    startDate: '2026-04-05T09:00:00Z',
    endDate: '2026-04-05T14:00:00Z',
    location: 'Community Park',
    address: '123 Main Street',
    category: 'outreach',
    isRsvped: false,
    attendeeCount: 28,
    organizer: 'Outreach Committee',
  },
];

const categoryColors: Record<string, string> = {
  worship: colors.primary,
  fellowship: colors.info,
  outreach: colors.success,
  youth: colors.secondary,
  conference: colors.warning,
  other: colors.muted,
};

export function EventsScreen() {
  const navigation = useNavigation<EventsNav>();
  const [events, setEvents] = useState<ChurchEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // TODO: Replace with eventService.getEvents()
    const loadEvents = async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 500));
        setEvents(mockEvents);
      } catch (error) {
        console.error('Failed to load events:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadEvents();
  }, []);

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

  const handleRsvp = (eventId: string) => {
    // TODO: Replace with eventService.rsvp / cancelRsvp
    setEvents((prev) =>
      prev.map((e) =>
        e.id === eventId
          ? {
              ...e,
              isRsvped: !e.isRsvped,
              attendeeCount: e.isRsvped
                ? e.attendeeCount - 1
                : e.attendeeCount + 1,
            }
          : e,
      ),
    );
  };

  const renderEvent = ({ item }: { item: ChurchEvent }) => {
    const { day, month, time } = formatDate(item.startDate);
    const catColor = categoryColors[item.category] || colors.muted;

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() =>
          navigation.navigate('EventDetail', { eventId: item.id })
        }
      >
        <Card style={styles.eventCard}>
          <View style={styles.eventRow}>
            {/* Date Badge */}
            <View style={styles.dateBadge}>
              <Text style={styles.dateMonth}>{month}</Text>
              <Text style={styles.dateDay}>{day}</Text>
            </View>

            {/* Event Info */}
            <View style={styles.eventInfo}>
              <View style={styles.eventHeader}>
                <View
                  style={[styles.categoryDot, { backgroundColor: catColor }]}
                />
                <Text style={styles.categoryText}>{item.category}</Text>
              </View>
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

          {/* RSVP Button */}
          <View style={styles.rsvpRow}>
            <Button
              title={item.isRsvped ? 'Cancel RSVP' : 'RSVP'}
              variant={item.isRsvped ? 'outline' : 'primary'}
              size="sm"
              onPress={() => handleRsvp(item.id)}
            />
          </View>
        </Card>
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={events}
      keyExtractor={(item) => item.id}
      renderItem={renderEvent}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No upcoming events.</Text>
        </View>
      }
    />
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
  list: {
    padding: spacing.xl,
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
    fontWeight: typography.weights.semibold,
    color: colors.primary,
    textTransform: 'uppercase',
  },
  dateDay: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.primary,
  },
  eventInfo: {
    flex: 1,
  },
  eventHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  categoryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  categoryText: {
    fontSize: typography.sizes.xs,
    color: colors.muted,
    textTransform: 'capitalize',
  },
  eventTitle: {
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.semibold,
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
  empty: {
    alignItems: 'center',
    paddingTop: spacing['4xl'],
  },
  emptyText: {
    fontSize: typography.sizes.base,
    color: colors.muted,
  },
});
