import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Card } from '../../components/common/Card';
import { StatePanel } from '../../components/common/StatePanel';
import { borderRadius, colors, spacing, typography } from '../../theme';
import campaignService, {
  showsProgress,
  type PublishedCampaign,
} from '../../services/campaign.service';

/**
 * The church's fundraising appeals.
 *
 * Only what the church chose to show its members — the narrowing happens in the
 * server's query, not here. A screen that fetched every campaign and hid the
 * drafts would be one careless edit away from showing a congregation an appeal
 * its leadership had not announced yet.
 */

function formatAmount(minor: number, currency: string): string {
  const major = minor / 100;
  return `${currency} ${major.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function daysLeft(endDate: string): string | null {
  const end = new Date(endDate).getTime();
  if (Number.isNaN(end)) return null;
  const days = Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) return 'Closed';
  if (days === 0) return 'Last day';
  if (days === 1) return '1 day left';
  return `${days} days left`;
}

function CampaignCard({
  campaign,
  onGive,
}: {
  campaign: PublishedCampaign;
  onGive: (campaign: PublishedCampaign) => void;
}) {
  const remaining = daysLeft(campaign.endDate);
  const withProgress = showsProgress(campaign);

  return (
    <Card style={styles.card}>
      {campaign.coverImageUrl ? (
        <Image
          source={{ uri: campaign.coverImageUrl }}
          style={styles.cover}
          accessibilityIgnoresInvertColors
        />
      ) : null}

      <View style={styles.body}>
        <Text style={styles.title}>{campaign.title}</Text>
        {campaign.description ? (
          <Text style={styles.description} numberOfLines={3}>
            {campaign.description}
          </Text>
        ) : null}

        {/*
          The thermometer appears only when the church turned it on. When it is
          off, the TARGET is still shown — an appeal with no figure at all reads
          as unfinished — but the raised amount is simply absent rather than
          rendered as zero, which would tell a congregation its church is
          failing when in fact its church chose privacy.
        */}
        {withProgress ? (
          <View style={styles.progressBlock}>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  { width: `${Math.min(100, Math.max(0, campaign.progress ?? 0))}%` },
                ]}
              />
            </View>
            <View style={styles.figures}>
              <Text style={styles.raised}>
                {formatAmount(campaign.currentAmount ?? 0, campaign.currency)}
              </Text>
              <Text style={styles.target}>
                of {formatAmount(campaign.targetAmount, campaign.currency)}
              </Text>
            </View>
          </View>
        ) : (
          <Text style={styles.targetOnly}>
            Goal: {formatAmount(campaign.targetAmount, campaign.currency)}
          </Text>
        )}

        <View style={styles.footer}>
          {remaining ? <Text style={styles.remaining}>{remaining}</Text> : <View />}
          <TouchableOpacity
            style={styles.giveButton}
            onPress={() => onGive(campaign)}
            accessibilityRole="button"
            accessibilityLabel={`Give to ${campaign.title}`}
          >
            <Text style={styles.giveText}>Give</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Card>
  );
}

export function CampaignsScreen() {
  const navigation = useNavigation<{ navigate: (screen: string, params?: object) => void }>();
  const [campaigns, setCampaigns] = useState<PublishedCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setCampaigns(await campaignService.myCampaigns());
    } catch {
      setError('We could not load the appeals. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onGive = useCallback(
    (campaign: PublishedCampaign) => {
      // Straight into the ordinary giving flow with the campaign chosen.
      // Reaching an appeal and then having to pick it again from a dropdown
      // is where people stop.
      navigation.navigate('Giving', {
        campaignId: campaign.id,
        campaignTitle: campaign.title,
      });
    },
    [navigation],
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      data={campaigns}
      keyExtractor={(c) => c.id}
      contentContainerStyle={campaigns.length === 0 ? styles.emptyContent : styles.content}
      renderItem={({ item }) => <CampaignCard campaign={item} onGive={onGive} />}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load(true)}
          tintColor={colors.primary}
        />
      }
      ListEmptyComponent={
        error ? (
          <StatePanel
            title="Could not load appeals"
            icon="alert-circle-outline"
            message={error}
            actionLabel="Try again"
            onAction={() => void load()}
          />
        ) : (
          <StatePanel
            title="No appeals right now"
            icon="megaphone-outline"
            message="When your church starts a fundraising appeal, it will appear here."
          />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  emptyContent: { flexGrow: 1, justifyContent: 'center', padding: spacing.md },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { marginBottom: spacing.md, overflow: 'hidden', padding: 0 },
  cover: { width: '100%', height: 160, backgroundColor: colors.background },
  body: { padding: spacing.md },
  title: {
    color: colors.text,
    fontFamily: typography.families.bold,
    fontSize: typography.sizes.lg,
    marginBottom: spacing.xs,
  },
  description: {
    color: colors.textSecondary,
    fontFamily: typography.families.regular,
    fontSize: typography.sizes.sm,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  progressBlock: { marginBottom: spacing.md },
  track: {
    height: 8,
    backgroundColor: colors.background,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  fill: { height: '100%', backgroundColor: colors.primary },
  figures: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  raised: {
    color: colors.text,
    fontFamily: typography.families.bold,
    fontSize: typography.sizes.md,
  },
  target: {
    color: colors.textSecondary,
    fontFamily: typography.families.regular,
    fontSize: typography.sizes.sm,
  },
  targetOnly: {
    color: colors.textSecondary,
    fontFamily: typography.families.medium,
    fontSize: typography.sizes.sm,
    marginBottom: spacing.md,
  },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  remaining: {
    color: colors.textSecondary,
    fontFamily: typography.families.regular,
    fontSize: typography.sizes.xs,
  },
  giveButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  giveText: {
    color: colors.surface,
    fontFamily: typography.families.bold,
    fontSize: typography.sizes.md,
  },
});

export default CampaignsScreen;
