import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Image,
  Modal,
  Alert,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Avatar } from '../../components/common/Avatar';
import { Card } from '../../components/common/Card';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';
import type { Post, ReportReason } from '../../services/social.service';
import socialService from '../../services/social.service';
import { ScreenSkeleton } from '../../components/common/ScreenSkeleton';
import { createKeyedSubmissionLock } from '../../services/submission-lock';
import { useAuth } from '../../hooks/useAuth';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import { createLatestRequestGate } from '../../services/latest-request';
import { appendUniquePageById, reconcileToggleCount, rollbackOptimisticToggle } from '../../services/list-reconciliation';
import { connectivityErrorMessage } from '../../services/connectivity';
import { communityFeedBelongsToIdentity, communityPartialRecoveryAction, nextCommunityPage, type CommunityFeedOwner } from './community-state';
import { useAnimatedRouteTop } from '../../hooks/useAnimatedRouteTop';
import { paginationActionState } from '../../components/common/pagination-action';
import { Ionicons } from '@expo/vector-icons';
import { StatePanel } from '../../components/common/StatePanel';
import { communityMutationFailure } from './community-mutation';

type FeedNav = NativeStackNavigationProp<RootStackParamList>;

const REPORT_OPTIONS: Array<{ value: ReportReason; label: string }> = [
  { value: 'spam', label: 'Spam or promotion' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'misleading', label: 'Misleading information' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'privacy', label: 'Privacy concern' },
];
const FEED_PAGE_SIZE = 30;

export function reportSheetActionState(reasonSelected: boolean, busy: boolean) {
  return {
    optionDisabled: busy,
    cancelDisabled: busy,
    submitDisabled: !reasonSelected || busy,
    busy,
  };
}

export function FeedScreen() {
  const navigation = useNavigation<FeedNav>();
  const { user } = useAuth();
  const offline = useKnownOffline();
  const [posts, setPosts] = useState<Post[]>([]);
  const [feedOwner, setFeedOwner] = useState<CommunityFeedOwner | null>(() => ({
    churchId: user?.churchId,
    memberId: user?.memberId,
  }));
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedPage, setLoadedPage] = useState(0);
  const [totalPosts, setTotalPosts] = useState(0);
  const [error, setError] = useState('');
  const [likingIds, setLikingIds] = useState<Set<string>>(() => new Set());
  const [reportingPost, setReportingPost] = useState<Post | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason | null>(null);
  const [reportingIds, setReportingIds] = useState<Set<string>>(() => new Set());
  const [reportedIds, setReportedIds] = useState<Set<string>>(() => new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());
  const [deleteUnknownIds, setDeleteUnknownIds] = useState<Set<string>>(() => new Set());
  const hasLoaded = useRef(false);
  const reactionLock = useRef(createKeyedSubmissionLock());
  const reportLock = useRef(createKeyedSubmissionLock());
  const deleteLock = useRef(createKeyedSubmissionLock());
  const loadGate = useRef(createLatestRequestGate());
  const listRef = useRef<FlatList<Post>>(null);
  useAnimatedRouteTop(listRef);
  const mountedRef = useRef(true);
  const activeIdentityRef = useRef<CommunityFeedOwner>({ churchId: user?.churchId, memberId: user?.memberId });
  const feedOwnerRef = useRef(feedOwner);
  const activePostIdsRef = useRef(new Set<string>());
  activeIdentityRef.current = { churchId: user?.churchId, memberId: user?.memberId };
  feedOwnerRef.current = feedOwner;
  activePostIdsRef.current = new Set(posts.map((post) => post.id));

  const loadFeed = useCallback(async (refresh = false) => {
    const request = loadGate.current.begin();
    const startedOwner = { churchId: user?.churchId, memberId: user?.memberId };
    if (!communityFeedBelongsToIdentity(feedOwnerRef.current, startedOwner)) {
      feedOwnerRef.current = startedOwner;
      setFeedOwner(startedOwner);
      setPosts([]);
      setLikingIds(new Set());
      setReportingIds(new Set());
      setReportedIds(new Set());
      setReportingPost(null);
      setReportReason(null);
      setLoadingMore(false);
      setLoadedPage(0);
      setTotalPosts(0);
      setDeletingIds(new Set());
      setDeleteUnknownIds(new Set());
      reactionLock.current = createKeyedSubmissionLock();
      reportLock.current = createKeyedSubmissionLock();
      deleteLock.current = createKeyedSubmissionLock();
      hasLoaded.current = false;
    }
    if (refresh) setRefreshing(true);
    else {
      setRefreshing(false);
      if (!hasLoaded.current) setIsLoading(true);
    }
    setError('');
    setLoadingMore(false);
    try {
      if (!user?.churchId || !user.memberId) throw new Error('No church selected');
      const result = await socialService.getFeed(user.churchId, { page: 1, limit: FEED_PAGE_SIZE });
      if (loadGate.current.isLatest(request)) {
        setPosts(result.posts);
        const loadedOwner = { churchId: user.churchId, memberId: user.memberId };
        feedOwnerRef.current = loadedOwner;
        setFeedOwner(loadedOwner);
        setLoadedPage(1);
        setTotalPosts(result.total);
        setDeleteUnknownIds(new Set());
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
  }, [user?.churchId, user?.memberId]);

  const loadMore = async () => {
    const nextPage = nextCommunityPage(loadedPage, posts.length, totalPosts, offline || loadingMore || refreshing);
    if (nextPage === null) return;
    const request = loadGate.current.begin();
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.memberId;
    if (!startedChurchId || !startedMemberId
      || !communityFeedBelongsToIdentity(feedOwnerRef.current, activeIdentityRef.current)) return;
    setLoadingMore(true);
    setError('');
    try {
      const result = await socialService.getFeed(startedChurchId, { page: nextPage, limit: FEED_PAGE_SIZE });
      if (loadGate.current.isLatest(request)
        && activeIdentityRef.current.churchId === startedChurchId
        && activeIdentityRef.current.memberId === startedMemberId) {
        setPosts((current) => appendUniquePageById(current, result.posts));
        setLoadedPage(nextPage);
        setTotalPosts(result.total);
      }
    } catch (cause) {
      if (loadGate.current.isLatest(request)
        && activeIdentityRef.current.churchId === startedChurchId
        && activeIdentityRef.current.memberId === startedMemberId) {
        setError(connectivityErrorMessage(cause, 'Older community posts could not be loaded.'));
      }
    } finally {
      if (loadGate.current.isLatest(request)) setLoadingMore(false);
    }
  };

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
    const startedMemberId = user?.memberId;
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
    } catch (cause) {
      if (!mountedRef.current
        || activeIdentityRef.current.churchId !== startedChurchId
        || activeIdentityRef.current.memberId !== startedMemberId
        || !activePostIdsRef.current.has(post.id)) return;
      const failure = communityMutationFailure('reaction', cause);
      setPosts((current) => current.map((item) => {
        if (item.id !== post.id) return item;
        if (failure.outcomeUnknown) {
          return { ...item, reactionStatusKnown: false };
        }
        const reconciled = rollbackOptimisticToggle(
          { selected: item.isLiked, count: item.likesCount },
          optimistic,
          previous,
        );
        return { ...item, isLiked: reconciled.selected, likesCount: reconciled.count };
      }));
      setError(failure.message);
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

  const handleReport = async () => {
    const post = reportingPost;
    if (!post || !reportReason || offline || reportedIds.has(post.id)) return;
    const actionLock = reportLock.current;
    if (!actionLock.acquire(post.id)) return;
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.memberId;
    if (!startedChurchId || !startedMemberId
      || !mountedRef.current
      || !communityFeedBelongsToIdentity(feedOwnerRef.current, activeIdentityRef.current)
      || !activePostIdsRef.current.has(post.id)) {
      actionLock.release(post.id);
      return;
    }
    setReportingIds((current) => new Set(current).add(post.id));
    try {
      await socialService.reportPost(post.id, reportReason);
      if (!mountedRef.current
        || activeIdentityRef.current.churchId !== startedChurchId
        || activeIdentityRef.current.memberId !== startedMemberId
        || !activePostIdsRef.current.has(post.id)) return;
      setReportedIds((current) => new Set(current).add(post.id));
      setReportingPost(null);
      setReportReason(null);
      Alert.alert('Report received', 'Your church moderation team can now review this post. Reporting does not remove it automatically.');
    } catch (cause) {
      if (!mountedRef.current
        || activeIdentityRef.current.churchId !== startedChurchId
        || activeIdentityRef.current.memberId !== startedMemberId
        || !activePostIdsRef.current.has(post.id)) return;
      const failure = communityMutationFailure('report', cause);
      if (failure.outcomeUnknown) {
        setReportedIds((current) => new Set(current).add(post.id));
        setReportingPost(null);
        setReportReason(null);
      }
      Alert.alert(failure.title, failure.message);
    } finally {
      actionLock.release(post.id);
      if (mountedRef.current) {
        setReportingIds((current) => {
          const next = new Set(current);
          next.delete(post.id);
          return next;
        });
      }
    }
  };

  const deleteOwnedPost = async (post: Post, actionLock: ReturnType<typeof createKeyedSubmissionLock>) => {
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.memberId;
    if (!startedChurchId || !startedMemberId || post.authorId !== startedMemberId
      || !mountedRef.current
      || !communityFeedBelongsToIdentity(feedOwnerRef.current, activeIdentityRef.current)
      || !activePostIdsRef.current.has(post.id)) {
      actionLock.release(post.id);
      return;
    }
    setError('');
    setDeletingIds((current) => new Set(current).add(post.id));
    try {
      await socialService.deletePost(post.id);
      if (!mountedRef.current
        || activeIdentityRef.current.churchId !== startedChurchId
        || activeIdentityRef.current.memberId !== startedMemberId
        || !activePostIdsRef.current.has(post.id)) return;
      setPosts((current) => current.filter((item) => item.id !== post.id));
      void loadFeed(true);
    } catch (cause) {
      if (!mountedRef.current
        || activeIdentityRef.current.churchId !== startedChurchId
        || activeIdentityRef.current.memberId !== startedMemberId
        || !activePostIdsRef.current.has(post.id)) return;
      const failure = communityMutationFailure('delete', cause);
      if (failure.outcomeUnknown) {
        setDeleteUnknownIds((current) => new Set(current).add(post.id));
      }
      setError(failure.message);
      Alert.alert(failure.title, failure.message);
    } finally {
      actionLock.release(post.id);
      if (mountedRef.current) {
        setDeletingIds((current) => {
          const next = new Set(current);
          next.delete(post.id);
          return next;
        });
      }
    }
  };

  const confirmDelete = (post: Post) => {
    const actionLock = deleteLock.current;
    if (offline || deleteUnknownIds.has(post.id) || post.authorId !== user?.memberId
      || !actionLock.acquire(post.id)) return;
    let started = false;
    Alert.alert(
      'Delete your post?',
      'This removes the post and its conversation from your church community. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => actionLock.release(post.id) },
        { text: 'Delete post', style: 'destructive', onPress: () => {
          started = true;
          void deleteOwnedPost(post, actionLock);
        } },
      ],
      { cancelable: true, onDismiss: () => { if (!started) actionLock.release(post.id); } },
    );
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

        {item.authorId !== user?.memberId ? (
          <TouchableOpacity
            style={[styles.actionButton, (offline || reportingIds.has(item.id) || reportedIds.has(item.id)) && styles.actionDisabled]}
            onPress={() => { setReportingPost(item); setReportReason(null); }}
            disabled={offline || reportingIds.has(item.id) || reportedIds.has(item.id)}
            accessibilityRole="button"
            accessibilityLabel={reportedIds.has(item.id) ? 'Post reported' : 'Report post'}
            accessibilityHint={offline ? 'Reconnect to report this post.' : 'Opens private reporting reasons for church moderators.'}
            accessibilityState={{ disabled: offline || reportingIds.has(item.id) || reportedIds.has(item.id), busy: reportingIds.has(item.id) }}
          >
            <Ionicons name={reportedIds.has(item.id) ? 'flag' : 'flag-outline'} size={18} color={reportedIds.has(item.id) ? colors.primary : colors.muted} accessible={false} />
            <Text style={[styles.actionText, reportedIds.has(item.id) && styles.actionTextActive]}>{reportedIds.has(item.id) ? 'Reported' : 'Report'}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.actionButton, (offline || deletingIds.has(item.id) || deleteUnknownIds.has(item.id)) && styles.actionDisabled]}
            onPress={() => confirmDelete(item)}
            disabled={offline || deletingIds.has(item.id) || deleteUnknownIds.has(item.id)}
            accessibilityRole="button"
            accessibilityLabel={deleteUnknownIds.has(item.id) ? 'Post deletion status unknown' : 'Delete your post'}
            accessibilityHint={offline
              ? 'Reconnect to delete this post.'
              : deleteUnknownIds.has(item.id)
                ? 'Refresh the community feed before trying again.'
                : 'Asks for confirmation before permanently deleting this post.'}
            accessibilityState={{ disabled: offline || deletingIds.has(item.id) || deleteUnknownIds.has(item.id), busy: deletingIds.has(item.id) }}
          >
            <Ionicons name="trash-outline" size={18} color={colors.error} accessible={false} />
            <Text style={styles.deleteActionText}>{deletingIds.has(item.id) ? 'Deleting…' : 'Delete'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </Card>
  );

  const ownsFeed = communityFeedBelongsToIdentity(feedOwner, activeIdentityRef.current);
  const visiblePosts = ownsFeed ? posts : [];
  const paginationAction = paginationActionState('older posts', {
    offline,
    loading: loadingMore,
    refreshing,
    requiresRefresh: false,
  });
  const reportActionState = reportSheetActionState(
    reportReason !== null,
    Boolean(reportingPost && reportingIds.has(reportingPost.id)),
  );
  const partialRecovery = communityPartialRecoveryAction(offline, 'feed');

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
                <TouchableOpacity
                  onPress={() => void loadFeed(true)}
                  accessibilityRole="button"
                  accessibilityLabel={partialRecovery.label}
                  disabled={partialRecovery.disabled}
                  accessibilityState={{ disabled: partialRecovery.disabled }}
                  accessibilityHint={partialRecovery.hint}
                  style={[styles.retryAction, partialRecovery.disabled && styles.actionDisabled]}
                >
                  <Text style={styles.retry}>{partialRecovery.label}</Text>
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
        ListFooterComponent={visiblePosts.length > 0 && visiblePosts.length < totalPosts ? (
          <TouchableOpacity
            style={[styles.loadMore, paginationAction.disabled && styles.actionDisabled]}
            onPress={() => void loadMore()}
            disabled={paginationAction.disabled}
            accessibilityRole="button"
            accessibilityLabel={paginationAction.label}
            accessibilityHint={paginationAction.hint}
            accessibilityState={{ disabled: paginationAction.disabled, busy: paginationAction.busy }}
          >
            <Text style={styles.loadMoreText}>{paginationAction.label}</Text>
          </TouchableOpacity>
        ) : visiblePosts.length > 0 ? <Text style={styles.endOfFeed}>You’re all caught up.</Text> : null}
      />
      <Modal
        visible={reportingPost !== null}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!reportingPost || !reportingIds.has(reportingPost.id)) setReportingPost(null); }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.reportSheet} accessibilityViewIsModal>
            <View style={styles.reportIcon}><Ionicons name="flag-outline" size={22} color={colors.primaryDark} /></View>
            <Text style={styles.reportTitle} accessibilityRole="header">Report this post</Text>
            <Text style={styles.reportBody}>Choose the clearest reason. Your report is private and the post stays visible until a moderator reviews it.</Text>
            {REPORT_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[styles.reportOption, reportReason === option.value && styles.reportOptionSelected]}
                onPress={() => setReportReason(option.value)}
                disabled={reportActionState.optionDisabled}
                accessibilityRole="radio"
                accessibilityState={{ checked: reportReason === option.value, disabled: reportActionState.optionDisabled }}
              >
                <Ionicons name={reportReason === option.value ? 'radio-button-on' : 'radio-button-off'} size={20} color={reportReason === option.value ? colors.primary : colors.muted} />
                <Text style={styles.reportOptionText}>{option.label}</Text>
              </TouchableOpacity>
            ))}
            <View style={styles.reportActions}>
              <TouchableOpacity style={[styles.reportCancel, reportActionState.cancelDisabled && styles.actionDisabled]} onPress={() => { setReportingPost(null); setReportReason(null); }} disabled={reportActionState.cancelDisabled} accessibilityRole="button" accessibilityState={{ disabled: reportActionState.cancelDisabled, busy: reportActionState.busy }}>
                <Text style={styles.reportCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.reportSubmit, reportActionState.submitDisabled && styles.actionDisabled]} onPress={() => void handleReport()} disabled={reportActionState.submitDisabled} accessibilityRole="button" accessibilityState={{ disabled: reportActionState.submitDisabled, busy: reportActionState.busy }}>
                <Text style={styles.reportSubmitText}>{reportActionState.busy ? 'Sending…' : 'Send report'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  retryAction: { minHeight: 44, justifyContent: 'center' },
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
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(7,30,27,.55)' },
  reportSheet: { backgroundColor: colors.surface, borderTopLeftRadius: borderRadius['2xl'], borderTopRightRadius: borderRadius['2xl'], padding: spacing.xl, paddingBottom: spacing['3xl'] },
  reportIcon: { width: 44, height: 44, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondaryLight, marginBottom: spacing.md },
  reportTitle: { color: colors.text, fontFamily: typography.families.bold, fontSize: typography.sizes.xl },
  reportBody: { color: colors.textSecondary, fontSize: typography.sizes.md, lineHeight: 21, marginTop: spacing.sm, marginBottom: spacing.lg },
  reportOption: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.lg, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  reportOptionSelected: { borderColor: colors.primary, backgroundColor: colors.secondaryLight },
  reportOptionText: { color: colors.text, fontFamily: typography.families.medium, fontSize: typography.sizes.md, marginLeft: spacing.sm },
  reportActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  reportCancel: { minHeight: 48, flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.lg },
  reportCancelText: { color: colors.textSecondary, fontFamily: typography.families.semibold, fontSize: typography.sizes.md },
  reportSubmit: { minHeight: 48, flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: borderRadius.lg },
  reportSubmitText: { color: colors.surface, fontFamily: typography.families.semibold, fontSize: typography.sizes.md },
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
  deleteActionText: {
    color: colors.error,
    fontFamily: typography.families.medium,
    fontSize: typography.sizes.sm,
  },
  loadMore: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginVertical: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.lg, backgroundColor: colors.surface },
  loadMoreText: { color: colors.primary, fontFamily: typography.families.semibold, fontSize: typography.sizes.md },
  endOfFeed: { color: colors.muted, fontSize: typography.sizes.sm, textAlign: 'center', paddingVertical: spacing.xl },
});
