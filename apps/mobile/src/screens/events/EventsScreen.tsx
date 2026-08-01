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
import eventService from '../../services/event.service';

type EventsNav = NativeStackNavigationProp<RootStackParamList>;

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
  const [error, setError] = useState('');

  useEffect(() => {
    const loadEvents = async () => {
      try {
        setError('');
        const result = await eventService.getEvents({ upcoming: true, limit: 50 });
        setEvents(result.events);
      } catch {
        setError('We could not load upcoming events.');
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

  const handleRsvp = async (event: ChurchEvent) => {
    try {
      const response = event.isRsvped
        ? await eventService.cancelRsvp(event.id)
        : await eventService.rsvp(event.id);
      setEvents((current) => current.map((item) => item.id === event.id ? {
        ...item,
        isRsvped: response.status === 'confirmed',
        attendeeCount: response.attendeeCount,
      } : item));
    } catch {
      setError('We could not update that RSVP. Try again.');
    }
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
              onPress={() => void handleRsvp(item)}
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
          <Text style={styles.emptyText}>{error || 'No upcoming events have been published yet.'}</Text>
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
