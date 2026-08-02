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
} from 'react-native';
import { RouteProp, useFocusEffect, useRoute } from '@react-navigation/native';
import { Avatar } from '../../components/common/Avatar';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import { ScreenSkeleton } from '../../components/common/ScreenSkeleton';
import type { RootStackParamList } from '../../components/navigation/AppNavigator';
import socialService, { type Comment } from '../../services/social.service';
import { borderRadius, colors, spacing, typography } from '../../theme';
import { createSubmissionLock } from '../../services/submission-lock';
import { useKnownOffline } from '../../hooks/useKnownOffline';
import { createLatestRequestGate } from '../../services/latest-request';
import { insertUniqueById } from '../../services/list-reconciliation';
import { connectivityErrorMessage } from '../../services/connectivity';
import { useAuth } from '../../hooks/useAuth';
import { httpStatus } from '../../services/api-error';
import { StatePanel } from '../../components/common/StatePanel';

type CommentsRoute = RouteProp<RootStackParamList, 'PostComments'>;

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
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsOwner, setCommentsOwner] = useState(() => ({
    postId: params.postId,
    churchId: user?.churchId,
    memberId: user?.id,
  }));
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [confirmedPostId, setConfirmedPostId] = useState<string | null>(null);
  const hasLoaded = useRef(false);
  const submissionLock = useRef(createSubmissionLock());
  const loadGate = useRef(createLatestRequestGate());
  const mountedRef = useRef(true);
  const commentsOwnerRef = useRef(commentsOwner);
  const activeContextRef = useRef({ postId: params.postId, churchId: user?.churchId, memberId: user?.id });
  const previousContextRef = useRef(activeContextRef.current);
  activeContextRef.current = { postId: params.postId, churchId: user?.churchId, memberId: user?.id };
  commentsOwnerRef.current = commentsOwner;

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
      setSubmitting(false);
      submissionLock.current = createSubmissionLock();
      previousContextRef.current = current;
    }
  }, [params.postId, user?.churchId, user?.id]);

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
      memberId: user?.id,
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
    try {
      const result = await socialService.getComments(params.postId, { limit: 50 });
      if (loadGate.current.isLatest(request)) {
        setComments(result.comments);
        setConfirmedPostId(params.postId);
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
  }, [params.postId, user?.churchId, user?.id]);

  useFocusEffect(useCallback(() => {
    const gate = loadGate.current;
    void load();
    return () => gate.invalidate();
  }, [load]));

  const submit = async () => {
    const message = content.trim();
    const startedPostId = params.postId;
    const startedChurchId = user?.churchId;
    const startedMemberId = user?.id;
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
    } catch {
      if (startedChurchId && startedMemberId
        && ownsActiveContext(startedPostId, startedChurchId, startedMemberId)) {
        setSubmitError('Your comment was not shared. Check your connection and try again.');
      }
    } finally {
      actionLock.release();
      if (ownsActiveContext(startedPostId, startedChurchId, startedMemberId)) {
        setSubmitting(false);
      }
    }
  };

  const ownsComments = user?.churchId && user.id
    ? ownsSocialMutationContext(commentsOwner, params.postId, user.churchId, user.id)
    : false;

  if (loading || !ownsComments) return <ScreenSkeleton cards={4} />;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={92}
    >
      <FlatList
        data={comments}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { if (!offline) void load(true); }} enabled={!offline} tintColor={colors.primary} />}
        ListHeaderComponent={(
          <>
            {params.postTitle ? <Text style={styles.postTitle} numberOfLines={2}>{params.postTitle}</Text> : null}
            {loadError && comments.length > 0 ? (
              <View style={styles.loadErrorBanner}>
                <Text style={styles.loadErrorText} accessibilityRole="alert">{loadError} Showing the last loaded comments.</Text>
                <TouchableOpacity onPress={() => void load(true)} accessibilityRole="button" disabled={offline} accessibilityState={{ disabled: offline }} accessibilityHint={offline ? 'Reconnect to refresh comments.' : undefined} style={offline && styles.actionDisabled}>
                  <Text style={styles.bannerRetry}>{offline ? 'Reconnect to retry' : 'Try again'}</Text>
                </TouchableOpacity>
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
      />

      <View style={styles.composer}>
        {submitError ? <Text style={styles.composerError} accessibilityRole="alert">{submitError}</Text> : null}
        <View style={styles.composerRow}>
          <TextInput
            value={content}
            onChangeText={(value) => { setContent(value); setSubmitError(''); }}
            placeholder="Write a kind response"
            placeholderTextColor={colors.muted}
            multiline
            maxLength={500}
            style={styles.input}
            accessibilityLabel="Comment"
          />
          <Button
            title="Send"
            size="sm"
            onPress={submit}
            loading={submitting}
            disabled={offline || !canSubmitCommentToPost(confirmedPostId, params.postId) || !content.trim() || submitting}
            accessibilityHint={offline
              ? 'Reconnect to share this comment.'
              : !canSubmitCommentToPost(confirmedPostId, params.postId)
                ? 'Load this comment thread before sharing a response.'
                : undefined}
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
});
