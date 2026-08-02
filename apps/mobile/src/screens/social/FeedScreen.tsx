import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Image,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Avatar } from '../../components/common/Avatar';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';
import type { Post } from '../../services/social.service';
import socialService from '../../services/social.service';
import { ScreenSkeleton } from '../../components/common/ScreenSkeleton';
import { createKeyedSubmissionLock } from '../../services/submission-lock';
import { useAuth } from '../../hooks/useAuth';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import { createLatestRequestGate } from '../../services/latest-request';
import { reconcileToggleCount, rollbackOptimisticToggle } from '../../services/list-reconciliation';
import { connectivityErrorMessage } from '../../services/connectivity';
import { communityFeedBelongsToIdentity, type CommunityFeedOwner } from './community-state';
import { useAnimatedRouteTop } from '../../hooks/useAnimatedRouteTop';
import { Ionicons } from '@expo/vector-icons';
import { StatePanel } from '../../components/common/StatePanel';

type FeedNav = NativeStackNavigationProp<RootStackParamList>;

export function FeedScreen() {
  const navigation = useNavigation<FeedNav>();
  const { user } = useAuth();
  const offline = useKnownOffline();
  const [posts, setPosts] = useState<Post[]>([]);
  const [feedOwner, setFeedOwner] = useState<CommunityFeedOwner | null>(() => ({
    churchId: user?.churchId,
    memberId: user?.id,
  }));
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [likingIds, setLikingIds] = useState<Set<string>>(() => new Set());
  const hasLoaded = useRef(false);
  const reactionLock = useRef(createKeyedSubmissionLock());
  const loadGate = useRef(createLatestRequestGate());
  const listRef = useRef<FlatList<Post>>(null);
  useAnimatedRouteTop(listRef);
  const mountedRef = useRef(true);
  const activeIdentityRef = useRef<CommunityFeedOwner>({ churchId: user?.churchId, memberId: user?.id });
  const feedOwnerRef = useRef(feedOwner);
  const activePostIdsRef = useRef(new Set<string>());
  activeIdentityRef.current = { churchId: user?.churchId, memberId: user?.id };
  feedOwnerRef.current = feedOwner;
  activePostIdsRef.current = new Set(posts.map((post) => post.id));

  const loadFeed = useCallback(async (refresh = false) => {
    const request = loadGate.current.begin();
    const startedOwner = { churchId: user?.churchId, memberId: user?.id };
    if (!communityFeedBelongsToIdentity(feedOwnerRef.current, startedOwner)) {
      feedOwnerRef.current = startedOwner;
      setFeedOwner(startedOwner);
      setPosts([]);
      setLikingIds(new Set());
      reactionLock.current = createKeyedSubmissionLock();
      hasLoaded.current = false;
    }
    if (refresh) setRefreshing(true);
    else {
      setRefreshing(false);
      if (!hasLoaded.current) setIsLoading(true);
    }
    setError('');
    try {
      if (!user?.churchId || !user.id) throw new Error('No church selected');
      const result = await socialService.getFeed(user.churchId, { limit: 30 });
      if (loadGate.current.isLatest(request)) {
        setPosts(result.posts);
        const loadedOwner = { churchId: user.churchId, memberId: user.id };
        feedOwnerRef.current = loadedOwner;
        setFeedOwner(loadedOwner);
      }
    } catch (cause) {
      if (loadGate.current.isLatest(request)) {
        setError(connectivityErrorMessage(cause, 'We could not load the community feed.'));
      }
    } finally {
      if (loadGate.current.isLatest(request)) {
        hasLoaded.current = true;
        setIsLoading(false);
        setRefreshing(false);
      }
    }
  }, [user?.churchId, user?.id]);

  useFocusEffect(useCallback(() => {
    mountedRef.current = true;
    const gate = loadGate.current;
    void loadFeed();
    return () => { mountedRef.current = false; gate.invalidate(); };
  }, [loadFeed]));

  const handleLike = async (post: Post) => {
    if (!post.reactionStatusKnown) return;
    if (!reactionLock.current.acquire(post.id)) return;
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.id;
    if (!startedChurchId || !startedMemberId
      || !mountedRef.current
      || !communityFeedBelongsToIdentity(feedOwnerRef.current, activeIdentityRef.current)
      || !activePostIdsRef.current.has(post.id)) {
      reactionLock.current.release(post.id);
      return;
    }
    const previous = { selected: post.isLiked, count: post.likesCount };
    const optimistic = reconcileToggleCount(previous, !post.isLiked);
    setError('');
    setLikingIds((current) => new Set(current).add(post.id));
    setPosts((current) => current.map((item) => item.id === post.id ? {
      ...item,
      isLiked: optimistic.selected,
      likesCount: optimistic.count,
    } : item));
    try {
      const result = post.isLiked ? await socialService.unlikePost(post.id) : await socialService.likePost(post.id);
      if (!mountedRef.current
        || activeIdentityRef.current.churchId !== startedChurchId
        || activeIdentityRef.current.memberId !== startedMemberId
        || !activePostIdsRef.current.has(post.id)) return;
      setPosts((current) => current.map((item) => {
        if (item.id !== post.id) return item;
        const reconciled = reconcileToggleCount(
          { selected: item.isLiked, count: item.likesCount },
          optimistic.selected,
          result.likesCount,
        );
        return {
          ...item,
          isLiked: reconciled.selected,
          reactionStatusKnown: true,
          likesCount: reconciled.count,
        };
      }));
    } catch {
      if (!mountedRef.current
        || activeIdentityRef.current.churchId !== startedChurchId
        || activeIdentityRef.current.memberId !== startedMemberId
        || !activePostIdsRef.current.has(post.id)) return;
      setPosts((current) => current.map((item) => {
        if (item.id !== post.id) return item;
        const reconciled = rollbackOptimisticToggle(
          { selected: item.isLiked, count: item.likesCount },
          optimistic,
          previous,
        );
        return { ...item, isLiked: reconciled.selected, likesCount: reconciled.count };
      }));
      setError('Your reaction was not saved. Try again.');
    } finally {
      reactionLock.current.release(post.id);
      if (mountedRef.current) {
        setLikingIds((current) => {
          const next = new Set(current);
          next.delete(post.id);
          return next;
        });
      }
    }
  };

  const timeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const renderPost = ({ item }: { item: Post }) => (
    <Card style={styles.postCard}>
      <View style={styles.postAccent} accessible={false} />
      {/* Author Row */}
      <View style={styles.authorRow}>
        <Avatar name={item.authorName} uri={item.authorAvatar} size="md" />
        <View style={styles.authorInfo}>
          <Text style={styles.authorName}>{item.authorName}</Text>
          <View style={styles.postMetaRow}>
            <Text style={styles.postType}>{item.type === 'praise_report' ? 'Praise report' : item.type}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.postTime}>{timeAgo(item.createdAt)}</Text>
          </View>
        </View>
      </View>

      {/* Content */}
      <Text style={styles.postContent}>{item.content}</Text>
      {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={styles.postImage} accessibilityLabel={`Image shared by ${item.authorName}`} /> : null}

      {/* Actions */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionButton, (offline || !item.reactionStatusKnown || likingIds.has(item.id)) && styles.actionDisabled]}
          onPress={() => void handleLike(item)}
          accessibilityRole="button"
          accessibilityLabel={!item.reactionStatusKnown ? 'Reaction unavailable' : item.isLiked ? 'Unlike post' : 'Like post'}
          accessibilityHint={offline
            ? 'Reconnect to save a reaction.'
            : !item.reactionStatusKnown
              ? 'Refresh to confirm your current reaction before changing it.'
              : undefined}
          accessibilityState={{ busy: likingIds.has(item.id), disabled: offline || !item.reactionStatusKnown || likingIds.has(item.id) }}
          disabled={offline || !item.reactionStatusKnown || likingIds.has(item.id)}
        >
          <Ionicons name={item.isLiked ? 'heart' : 'heart-outline'} size={19} color={item.isLiked ? colors.primary : colors.muted} accessible={false} />
          <Text
            style={[
              styles.actionText,
              item.isLiked && styles.actionTextActive,
            ]}
          >
            {item.likesCount}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate('PostComments', { postId: item.id, postTitle: item.content })}
          accessibilityRole="button"
          accessibilityLabel={`View ${item.commentsCount} comments`}
        >
          <Ionicons name="chatbubble-outline" size={18} color={colors.muted} accessible={false} />
          <Text style={styles.actionText}>{item.commentsCount}</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );

  const ownsFeed = communityFeedBelongsToIdentity(feedOwner, activeIdentityRef.current);
  const visiblePosts = ownsFeed ? posts : [];

  if (isLoading || !ownsFeed) {
    return <ScreenSkeleton cards={4} />;
  }

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={visiblePosts}
        keyExtractor={(item) => item.id}
        renderItem={renderPost}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { if (!offline) void loadFeed(true); }} enabled={!offline} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={(
          <>
            <TouchableOpacity
              style={styles.createPostBar}
              onPress={() => navigation.navigate('CreatePost')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Create a community post"
            >
              <Avatar name={`${user?.firstName ?? 'Member'} ${user?.lastName ?? ''}`.trim()} uri={user?.avatar} size="sm" />
              <View style={styles.createPostCopy}>
                <Text style={styles.createPostEyebrow}>YOUR CHURCH COMMUNITY</Text>
                <Text style={styles.createPostText}>Share a testimony, update, or praise report.</Text>
              </View>
              <View style={styles.createPostIcon}><Ionicons name="add" size={20} color={colors.surface} accessible={false} /></View>
            </TouchableOpacity>
            {(error && visiblePosts.length > 0) || visiblePosts.some((post) => !post.reactionStatusKnown) ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText} accessibilityRole="alert">
                  {error || 'Some reaction statuses are unavailable. Refresh before liking or unliking those posts.'}
                </Text>
                <TouchableOpacity onPress={() => void loadFeed(true)} accessibilityRole="button" disabled={offline} accessibilityState={{ disabled: offline }} accessibilityHint={offline ? 'Reconnect to refresh community posts.' : undefined} style={offline && styles.actionDisabled}>
                  <Text style={styles.retry}>{offline ? 'Reconnect to retry' : 'Try again'}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        )}
        ListEmptyComponent={
          <StatePanel
            icon={error ? (offline ? 'cloud-offline-outline' : 'people-outline') : 'chatbubbles-outline'}
            tone={error ? (offline ? 'offline' : 'error') : 'quiet'}
            title={error ? (offline ? 'Your community is offline' : 'Community unavailable') : 'Start the conversation'}
            message={error || 'Share the first testimony, church update, or praise report with your community.'}
            actionLabel={error ? (offline ? 'Reconnect to retry' : 'Try again') : 'Create a post'}
            actionHint={offline ? 'Reconnect to load community posts.' : error ? 'Loads community posts again.' : 'Opens the new post screen.'}
            actionDisabled={offline}
            onAction={error ? () => void loadFeed() : () => navigation.navigate('CreatePost')}
          />
        }
      />
    </View>
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
    padding: spacing.base,
    flexGrow: 1,
  },
  createPostBar: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  createPostCopy: { flex: 1, marginHorizontal: spacing.md },
  createPostEyebrow: { color: colors.primary, fontFamily: typography.families.bold, fontSize: 9, letterSpacing: 1.05, marginBottom: 3 },
  createPostText: {
    fontFamily: typography.families.medium,
    fontSize: typography.sizes.md,
    lineHeight: 19,
    color: colors.text,
  },
  createPostIcon: { width: 38, height: 38, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: '#FFF7F5',
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.base,
  },
  errorText: { color: colors.error, fontSize: typography.sizes.sm, lineHeight: 19, flex: 1 },
  retry: { color: colors.primary, fontFamily: typography.families.semibold, fontSize: typography.sizes.sm, paddingVertical: spacing.xs },
  postCard: {
    marginBottom: spacing.lg,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  postAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: colors.primaryLight },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  authorInfo: {
    marginLeft: spacing.md,
    flex: 1,
  },
  authorName: {
    fontSize: typography.sizes.base,
    fontFamily: typography.families.semibold,
    color: colors.text,
  },
  postMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  postType: { color: colors.primary, fontFamily: typography.families.semibold, fontSize: typography.sizes.xs, textTransform: 'capitalize' },
  metaDot: { color: colors.muted, fontSize: typography.sizes.xs, marginHorizontal: spacing.xs },
  postTime: {
    fontSize: typography.sizes.sm,
    color: colors.muted,
    marginTop: 1,
  },
  postContent: {
    fontFamily: typography.families.regular,
    fontSize: typography.sizes.base,
    color: colors.text,
    lineHeight: 24,
    marginBottom: spacing.base,
  },
  postImage: { width: '100%', aspectRatio: 16 / 10, borderRadius: borderRadius.lg, backgroundColor: colors.surfaceMuted, marginBottom: spacing.base },
  actionRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: spacing.md,
    gap: spacing.xl,
  },
  actionButton: {
    minWidth: 44,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  actionDisabled: { opacity: 0.5 },
  actionText: {
    fontFamily: typography.families.medium,
    fontSize: typography.sizes.md,
    color: colors.muted,
  },
  actionTextActive: {
    color: colors.primary,
  },
});
