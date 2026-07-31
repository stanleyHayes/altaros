import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Input } from '../../components/common/Input';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { PrayerRequest, CreatePrayerRequest } from '../../services/spiritual.service';

const categories: { value: CreatePrayerRequest['category']; label: string }[] = [
  { value: 'health', label: 'Health' },
  { value: 'family', label: 'Family' },
  { value: 'finances', label: 'Finances' },
  { value: 'spiritual', label: 'Spiritual' },
  { value: 'other', label: 'Other' },
];

// TODO: Replace with real API data
const mockPrayerRequests: PrayerRequest[] = [
  {
    id: '1',
    title: 'Healing for my mother',
    description: 'Please pray for my mother who is recovering from surgery.',
    isAnonymous: false,
    category: 'health',
    prayerCount: 24,
    status: 'active',
    createdAt: '2026-03-28T10:00:00Z',
    authorName: 'Sister Mary',
  },
  {
    id: '2',
    title: 'Job search guidance',
    description: 'Praying for direction in my career transition.',
    isAnonymous: true,
    category: 'other',
    prayerCount: 18,
    status: 'active',
    createdAt: '2026-03-27T14:30:00Z',
  },
];

export function PrayerScreen() {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] =
    useState<CreatePrayerRequest['category']>('other');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requests] = useState<PrayerRequest[]>(mockPrayerRequests);

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) {
      Alert.alert('Missing Fields', 'Please fill in both title and description.');
      return;
    }

    setIsSubmitting(true);
    try {
      // TODO: Replace with spiritualService.createPrayerRequest()
      await new Promise((resolve) => setTimeout(resolve, 500));
      Alert.alert('Prayer Request Submitted', 'Your prayer request has been shared with the community.');
      setTitle('');
      setDescription('');
      setCategory('other');
      setIsAnonymous(false);
      setShowForm(false);
    } catch {
      Alert.alert('Error', 'Failed to submit prayer request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePray = (requestId: string) => {
    // TODO: Replace with spiritualService.prayForRequest(requestId)
    Alert.alert('Prayed', 'You have prayed for this request.');
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Submit Button / Form Toggle */}
      <View style={styles.header}>
        <Button
          title={showForm ? 'Cancel' : 'Submit Prayer Request'}
          onPress={() => setShowForm(!showForm)}
          variant={showForm ? 'outline' : 'primary'}
          fullWidth
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
          />

          <Input
            label="Description"
            placeholder="Share your prayer request..."
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
            style={styles.textArea}
          />

          <Text style={styles.categoryLabel}>Category</Text>
          <View style={styles.categories}>
            {categories.map((cat) => (
              <TouchableOpacity
                key={cat.value}
                style={[
                  styles.categoryChip,
                  category === cat.value && styles.categoryChipActive,
                ]}
                onPress={() => setCategory(cat.value)}
              >
                <Text
                  style={[
                    styles.categoryChipText,
                    category === cat.value && styles.categoryChipTextActive,
                  ]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={styles.anonymousToggle}
            onPress={() => setIsAnonymous(!isAnonymous)}
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
            title="Submit"
            onPress={handleSubmit}
            loading={isSubmitting}
            fullWidth
          />
        </Card>
      )}

      {/* Prayer Requests List */}
      <View style={styles.listSection}>
        <Text style={styles.sectionTitle}>Community Prayer Requests</Text>
        {requests.map((request) => (
          <Card key={request.id} style={styles.requestCard}>
            <View style={styles.requestHeader}>
              <Text style={styles.requestTitle}>{request.title}</Text>
              <View style={styles.categoryBadge}>
                <Text style={styles.categoryBadgeText}>{request.category}</Text>
              </View>
            </View>
            <Text style={styles.requestDescription} numberOfLines={3}>
              {request.description}
            </Text>
            <View style={styles.requestFooter}>
              <Text style={styles.requestAuthor}>
                {request.isAnonymous ? 'Anonymous' : request.authorName}
              </Text>
              <TouchableOpacity
                style={styles.prayButton}
                onPress={() => handlePray(request.id)}
              >
                <Text style={styles.prayButtonText}>
                  Pray ({request.prayerCount})
                </Text>
              </TouchableOpacity>
            </View>
          </Card>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: spacing.xl,
  },
  formCard: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.xl,
  },
  formTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
    color: colors.text,
    marginBottom: spacing.base,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  categoryLabel: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.medium,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  categories: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.base,
  },
  categoryChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  categoryChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryChipText: {
    fontSize: typography.sizes.sm,
    color: colors.textSecondary,
  },
  categoryChipTextActive: {
    color: '#FFFFFF',
  },
  anonymousToggle: {
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
    fontWeight: typography.weights.bold,
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
    fontWeight: typography.weights.bold,
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
    fontWeight: typography.weights.semibold,
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  categoryBadge: {
    backgroundColor: colors.primaryLight + '20',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  categoryBadgeText: {
    fontSize: typography.sizes.xs,
    color: colors.primary,
    fontWeight: typography.weights.medium,
    textTransform: 'capitalize',
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
    backgroundColor: colors.primaryLight + '20',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  prayButtonText: {
    fontSize: typography.sizes.sm,
    color: colors.primary,
    fontWeight: typography.weights.semibold,
  },
});
