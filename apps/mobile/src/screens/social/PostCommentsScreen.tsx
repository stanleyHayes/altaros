import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';
import { Avatar } from '../../components/common/Avatar';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { ScreenSkeleton } from '../../components/common/ScreenSkeleton';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';
import socialService, { type Comment } from '../../services/social.service';
import { borderRadius, colors, spacing, typography } from '../../theme';
import { createKeyedSubmissionLock, createSubmissionLock } from '../../services/submission-lock';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import { createLatestRequestGate } from '../../services/latest-request';
import { appendUniquePageById, insertUniqueById } from '../../services/list-reconciliation';
import { connectivityErrorMessage } from '../../services/connectivity';
import { useAuth } from '../../hooks/useAuth';
import { httpStatus } from '../../services/api-error';
import { StatePanel } from '../../components/common/StatePanel';
import { useAnimatedRouteTop } from '../../hooks/useAnimatedRouteTop';
import { communityMutationFailure } from './community-mutation';
import { communityPartialRecoveryAction, nextCommunityPage } from './community-state';
import { Ionicons } from '@expo/vector-icons';
import { socialAuthoringActionState } from './social-authoring-state';
import { paginationActionState } from '../../components/common/pagination-action';
import { formKeyboardProps } from '../../components/common/form-keyboard';

type CommentsRoute = RouteProp<RootStackParamList, 'PostComments'>;
const COMMENT_PAGE_SIZE = 50;

export function canSubmitCommentToPost(
  confirmedPostId: string | null,
  requestedPostId: string,
): boolean {
  return confirmedPostId !== null && confirmedPostId === requestedPostId;
}

export function ownsSocialMutationContext(
  active: { postId: string; churchId?: string; memberId?: string },
  startedPostId: string,
  startedChurchId: string,
  startedMemberId: string,
): boolean {
  return active.postId === startedPostId
    && active.churchId === startedChurchId
    && active.memberId === startedMemberId;
}

export function socialMutationCompletionBelongsToContext(
  mounted: boolean,
  active: { postId: string; churchId?: string; memberId?: string },
  startedPostId: string,
  startedChurchId: string,
  startedMemberId: string,
): boolean {
  return mounted && ownsSocialMutationContext(
    active,
    startedPostId,
    startedChurchId,
    startedMemberId,
  );
}

export function PostCommentsScreen() {
  const { params } = useRoute<CommentsRoute>();
  const { user } = useAuth();
  const offline = useKnownOffline();
  const listRef = useRef<FlatList<Comment>>(null);
  useAnimatedRouteTop(listRef);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsOwner, setCommentsOwner] = useState(() => ({
    postId: params.postId,
    churchId: user?.churchId,
    memberId: user?.memberId,
  }));
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedPage, setLoadedPage] = useState(0);
  const [totalComments, setTotalComments] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitOutcomeUnknown, setSubmitOutcomeUnknown] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());
  const [deleteUnknownIds, setDeleteUnknownIds] = useState<Set<string>>(() => new Set());
  const [confirmedPostId, setConfirmedPostId] = useState<string | null>(null);
  const hasLoaded = useRef(false);
  const submissionLock = useRef(createSubmissionLock());
  const deleteLock = useRef(createKeyedSubmissionLock());
  const loadGate = useRef(createLatestRequestGate());
  const mountedRef = useRef(true);
  const commentsOwnerRef = useRef(commentsOwner);
  const activeContextRef = useRef({ postId: params.postId, churchId: user?.churchId, memberId: user?.memberId });
  const previousContextRef = useRef(activeContextRef.current);
  const activeCommentIdsRef = useRef(new Set<string>());
  const submitOutcomeUnknownRef = useRef(submitOutcomeUnknown);
  activeContextRef.current = { postId: params.postId, churchId: user?.churchId, memberId: user?.memberId };
  commentsOwnerRef.current = commentsOwner;
  activeCommentIdsRef.current = new Set(comments.map((comment) => comment.id));
  submitOutcomeUnknownRef.current = submitOutcomeUnknown;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const previous = previousContextRef.current;
    const current = activeContextRef.current;
    if (previous.postId !== current.postId
      || previous.churchId !== current.churchId
      || previous.memberId !== current.memberId) {
      loadGate.current.invalidate();
      hasLoaded.current = false;
      setComments([]);
      setContent('');
      setConfirmedPostId(null);
      setLoadError('');
      setSubmitError('');
      setSubmitOutcomeUnknown(false);
      submitOutcomeUnknownRef.current = false;
      setDeleteError('');
      setDeletingIds(new Set());
      setDeleteUnknownIds(new Set());
      setLoadingMore(false);
      setLoadedPage(0);
      setTotalComments(0);
      setSubmitting(false);
      submissionLock.current = createSubmissionLock();
      deleteLock.current = createKeyedSubmissionLock();
      previousContextRef.current = current;
    }
  }, [params.postId, user?.churchId, user?.memberId]);

  const ownsActiveContext = (postId: string, churchId: string, memberId: string) => (
    socialMutationCompletionBelongsToContext(
      mountedRef.current,
      activeContextRef.current,
      postId,
      churchId,
      memberId,
    )
  );

  const load = useCallback(async (refresh = false) => {
    const request = loadGate.current.begin();
    const startedContext = {
      postId: params.postId,
      churchId: user?.churchId,
      memberId: user?.memberId,
    };
    if (!startedContext.churchId || !startedContext.memberId) {
      commentsOwnerRef.current = startedContext;
      setCommentsOwner(startedContext);
    } else if (!ownsSocialMutationContext(
      commentsOwnerRef.current,
      startedContext.postId,
      startedContext.churchId,
      startedContext.memberId,
    )) {
      commentsOwnerRef.current = startedContext;
      setCommentsOwner(startedContext);
      setComments([]);
      setConfirmedPostId(null);
      hasLoaded.current = false;
    }
    if (refresh) setRefreshing(true);
    else {
      setRefreshing(false);
      if (!hasLoaded.current) setLoading(true);
    }
    setLoadError('');
    setLoadingMore(false);
    try {
      const result = await socialService.getComments(params.postId, { page: 1, limit: COMMENT_PAGE_SIZE });
      if (loadGate.current.isLatest(request)) {
        setComments(result.comments);
        setConfirmedPostId(params.postId);
        if (submitOutcomeUnknownRef.current) setContent('');
        setSubmitOutcomeUnknown(false);
        submitOutcomeUnknownRef.current = false;
        setDeleteError('');
        setDeleteUnknownIds(new Set());
        setLoadedPage(1);
        setTotalComments(result.total);
      }
    } catch (cause) {
      if (loadGate.current.isLatest(request)) {
        if (httpStatus(cause) === 404) setConfirmedPostId(null);
        setLoadError(connectivityErrorMessage(cause, 'Comments could not be loaded.'));
      }
    } finally {
      if (loadGate.current.isLatest(request)) {
        hasLoaded.current = true;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [params.postId, user?.churchId, user?.memberId]);

  const loadMore = async () => {
    const nextPage = nextCommunityPage(loadedPage, comments.length, totalComments, offline || loadingMore || refreshing);
    if (nextPage === null) return;
    const request = loadGate.current.begin();
    const startedPostId = params.postId;
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.memberId;
    if (!startedChurchId || !startedMemberId
      || !ownsSocialMutationContext(commentsOwnerRef.current, startedPostId, startedChurchId, startedMemberId)) return;
    setLoadingMore(true);
    setLoadError('');
    try {
      const result = await socialService.getComments(startedPostId, { page: nextPage, limit: COMMENT_PAGE_SIZE });
      if (loadGate.current.isLatest(request)
        && ownsActiveContext(startedPostId, startedChurchId, startedMemberId)) {
        setComments((current) => appendUniquePageById(current, result.comments));
        setLoadedPage(nextPage);
        setTotalComments(result.total);
      }
    } catch (cause) {
      if (loadGate.current.isLatest(request)
        && ownsActiveContext(startedPostId, startedChurchId, startedMemberId)) {
        setLoadError(connectivityErrorMessage(cause, 'Older comments could not be loaded.'));
      }
    } finally {
      if (loadGate.current.isLatest(request)) setLoadingMore(false);
    }
  };

  useFocusEffect(useCallback(() => {
    const gate = loadGate.current;
    void load();
    return () => gate.invalidate();
  }, [load]));

  const submit = async () => {
    const message = content.trim();
    const startedPostId = params.postId;
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.memberId;
    if (!message || !canSubmitCommentToPost(confirmedPostId, startedPostId)
      || !startedChurchId || !startedMemberId) return;
    const actionLock = submissionLock.current;
    if (!actionLock.acquire()) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const created = await socialService.addComment(startedPostId, message, startedMemberId);
      if (!ownsActiveContext(startedPostId, startedChurchId, startedMemberId)) return;
      setComments((current) => insertUniqueById(current, created, 'end'));
      setContent('');
      void load(true);
    } catch (error) {
      if (startedChurchId && startedMemberId
        && ownsActiveContext(startedPostId, startedChurchId, startedMemberId)) {
        const copy = communityMutationFailure('comment', error);
        setSubmitOutcomeUnknown(copy.outcomeUnknown);
        setSubmitError(copy.message);
      }
    } finally {
      actionLock.release();
      if (ownsActiveContext(startedPostId, startedChurchId, startedMemberId)) {
        setSubmitting(false);
      }
    }
  };

  const commentAction = socialAuthoringActionState(
    'comment',
    content,
    offline,
    submitting || (submitOutcomeUnknown && refreshing),
    submitOutcomeUnknown,
    Boolean(user?.churchId && user?.memberId
      && canSubmitCommentToPost(confirmedPostId, params.postId)),
  );
  const paginationAction = paginationActionState('older comments', {
    offline,
    loading: loadingMore,
    refreshing,
    requiresRefresh: false,
  });

  const deleteOwnedComment = async (comment: Comment, actionLock: ReturnType<typeof createKeyedSubmissionLock>) => {
    const startedPostId = params.postId;
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.memberId;
    if (!startedChurchId || !startedMemberId || comment.authorId !== startedMemberId
      || !ownsActiveContext(startedPostId, startedChurchId, startedMemberId)
      || !activeCommentIdsRef.current.has(comment.id)) {
      actionLock.release(comment.id);
      return;
    }
    setDeleteError('');
    setDeletingIds((current) => new Set(current).add(comment.id));
    try {
      await socialService.deleteComment(startedPostId, comment.id);
      if (!ownsActiveContext(startedPostId, startedChurchId, startedMemberId)
        || !activeCommentIdsRef.current.has(comment.id)) return;
      setComments((current) => current.filter((item) => item.id !== comment.id));
      void load(true);
    } catch (cause) {
      if (!ownsActiveContext(startedPostId, startedChurchId, startedMemberId)
        || !activeCommentIdsRef.current.has(comment.id)) return;
      const failure = communityMutationFailure('deleteComment', cause);
      if (failure.outcomeUnknown) {
        setDeleteUnknownIds((current) => new Set(current).add(comment.id));
      }
      setDeleteError(failure.message);
      Alert.alert(failure.title, failure.message);
    } finally {
      actionLock.release(comment.id);
      if (ownsActiveContext(startedPostId, startedChurchId, startedMemberId)) {
        setDeletingIds((current) => {
          const next = new Set(current);
          next.delete(comment.id);
          return next;
        });
      }
    }
  };

  const confirmDeleteComment = (comment: Comment) => {
    const actionLock = deleteLock.current;
    if (offline || deleteUnknownIds.has(comment.id) || comment.authorId !== user?.memberId
      || !actionLock.acquire(comment.id)) return;
    let started = false;
    Alert.alert(
      'Delete your comment?',
      'This permanently removes your response from this conversation.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => actionLock.release(comment.id) },
        { text: 'Delete comment', style: 'destructive', onPress: () => {
          started = true;
          void deleteOwnedComment(comment, actionLock);
        } },
      ],
      { cancelable: true, onDismiss: () => { if (!started) actionLock.release(comment.id); } },
    );
  };

  const ownsComments = user?.churchId && user.memberId
    ? ownsSocialMutationContext(commentsOwner, params.postId, user.churchId, user.memberId)
    : false;
  const partialRecovery = communityPartialRecoveryAction(offline, 'comments');

  if (loading || !ownsComments) return <ScreenSkeleton cards={4} />;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={92}
    >
      <FlatList
        ref={listRef}
        {...formKeyboardProps(Platform.OS)}
        data={comments}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { if (!offline) void load(true); }} enabled={!offline} tintColor={colors.primary} />}
        ListHeaderComponent={(
          <>
            {params.postTitle ? <Text style={styles.postTitle} numberOfLines={2}>{params.postTitle}</Text> : null}
            {(loadError || deleteError) && comments.length > 0 ? (
              <View style={styles.loadErrorBanner}>
                <Text style={styles.loadErrorText} accessibilityRole="alert">{deleteError || `${loadError} Showing the last loaded comments.`}</Text>
                {loadError || deleteUnknownIds.size > 0 ? (
                  <TouchableOpacity
                    onPress={() => void load(true)}
                    accessibilityRole="button"
                    accessibilityLabel={partialRecovery.label}
                    disabled={partialRecovery.disabled}
                    accessibilityState={{ disabled: partialRecovery.disabled }}
                    accessibilityHint={partialRecovery.hint}
                    style={[styles.retryAction, partialRecovery.disabled && styles.actionDisabled]}
                  >
                    <Text style={styles.bannerRetry}>{partialRecovery.label}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </>
        )}
        renderItem={({ item }) => (
          <Card style={styles.comment}>
            <Avatar name={item.authorName} uri={item.authorAvatar} size="sm" />
            <View style={styles.commentBody}>
              <Text style={styles.author}>{item.authorName}</Text>
              <Text style={styles.message}>{item.content}</Text>
              <Text style={styles.date}>{new Date(item.createdAt).toLocaleString('en-GH', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</Text>
            </View>
            {item.authorId === user?.memberId ? (
              <TouchableOpacity
                style={[styles.deleteComment, (offline || deletingIds.has(item.id) || deleteUnknownIds.has(item.id)) && styles.actionDisabled]}
                onPress={() => confirmDeleteComment(item)}
                disabled={offline || deletingIds.has(item.id) || deleteUnknownIds.has(item.id)}
                accessibilityRole="button"
                accessibilityLabel={deleteUnknownIds.has(item.id) ? 'Comment deletion status unknown' : 'Delete your comment'}
                accessibilityHint={offline ? 'Reconnect to delete this comment.' : deleteUnknownIds.has(item.id) ? 'Refresh this thread before trying again.' : 'Asks for confirmation before permanently deleting this comment.'}
                accessibilityState={{ disabled: offline || deletingIds.has(item.id) || deleteUnknownIds.has(item.id), busy: deletingIds.has(item.id) }}
              >
                <Ionicons name="trash-outline" size={17} color={colors.error} accessible={false} />
              </TouchableOpacity>
            ) : null}
          </Card>
        )}
        ListEmptyComponent={
          <StatePanel
            icon={loadError ? (offline ? 'cloud-offline-outline' : 'chatbubble-outline') : 'chatbubbles-outline'}
            tone={loadError ? (offline ? 'offline' : 'error') : 'quiet'}
            title={loadError ? (offline ? 'Comments are offline' : 'Comments unavailable') : 'Start the conversation'}
            message={loadError || 'Be the first person to leave a kind response to this post.'}
            actionLabel={loadError ? (offline ? 'Reconnect to retry' : 'Try again') : undefined}
            actionHint={offline ? 'Reconnect to load comments.' : 'Loads comments again.'}
            actionDisabled={offline}
            onAction={loadError ? () => void load() : undefined}
          />
        }
        ListFooterComponent={comments.length > 0 && comments.length < totalComments ? (
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
        ) : comments.length > 0 ? <Text style={styles.endOfThread}>End of conversation.</Text> : null}
      />

      <View style={styles.composer}>
        {submitError ? <Text style={styles.composerError} accessibilityRole="alert">{submitError}</Text> : null}
        <View style={styles.composerRow}>
          <TextInput
            value={content}
            onChangeText={(value) => {
              setContent(value);
              if (!submitOutcomeUnknown) setSubmitError('');
            }}
            placeholder="Write a kind response"
            placeholderTextColor={colors.muted}
            multiline
            maxLength={500}
            style={[styles.input, (submitting || submitOutcomeUnknown) && styles.actionDisabled]}
            accessibilityLabel="Comment"
            editable={!submitting && !submitOutcomeUnknown}
          />
          <Button
            title={commentAction.label}
            size="sm"
            onPress={commentAction.mode === 'recover' ? () => void load(true) : submit}
            loading={submitting}
            disabled={commentAction.disabled}
            accessibilityHint={commentAction.hint}
          />
        </View>
        <Text
          style={styles.count}
          accessibilityLabel={`${500 - content.length} characters remaining`}
          accessibilityLiveRegion="polite"
        >
          {content.length}/500
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: spacing.base, flexGrow: 1 },
  postTitle: { color: colors.text, fontFamily: typography.families.semibold, fontSize: typography.sizes.base, lineHeight: 22, marginBottom: spacing.lg, padding: spacing.md, backgroundColor: colors.secondaryLight, borderRadius: borderRadius.lg },
  loadErrorBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, backgroundColor: '#FFF7F5', borderRadius: borderRadius.lg, padding: spacing.md, marginBottom: spacing.md },
  loadErrorText: { color: colors.error, fontSize: typography.sizes.sm, lineHeight: 19, flex: 1 },
  bannerRetry: { color: colors.primary, fontFamily: typography.families.semibold, fontSize: typography.sizes.sm, paddingVertical: spacing.xs },
  retryAction: { minHeight: 44, justifyContent: 'center' },
  comment: { flexDirection: 'row', marginBottom: spacing.md },
  commentBody: { flex: 1, marginLeft: spacing.md },
  author: { color: colors.text, fontFamily: typography.families.semibold, fontSize: typography.sizes.md },
  message: { color: colors.textSecondary, fontSize: typography.sizes.md, lineHeight: 20, marginTop: spacing.xs },
  date: { color: colors.muted, fontSize: typography.sizes.xs, marginTop: spacing.sm },
  composer: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.md },
  composerRow: { width: '100%', maxWidth: 680, alignSelf: 'center', flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  input: { flex: 1, minHeight: 44, maxHeight: 112, backgroundColor: colors.surfaceMuted, borderRadius: borderRadius.lg, color: colors.text, fontSize: typography.sizes.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  count: { width: '100%', maxWidth: 680, alignSelf: 'center', color: colors.muted, fontSize: typography.sizes.xs, textAlign: 'right', marginTop: spacing.xs },
  composerError: { width: '100%', maxWidth: 680, alignSelf: 'center', color: colors.error, fontSize: typography.sizes.sm, marginBottom: spacing.sm },
  actionDisabled: { opacity: 0.5 },
  deleteComment: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginLeft: spacing.sm },
  loadMore: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginVertical: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: borderRadius.lg, backgroundColor: colors.surface },
  loadMoreText: { color: colors.primary, fontFamily: typography.families.semibold, fontSize: typography.sizes.md },
  endOfThread: { color: colors.muted, fontSize: typography.sizes.sm, textAlign: 'center', paddingVertical: spacing.xl },
});
