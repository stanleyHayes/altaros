import {
  canSubmitCommentToPost,
  ownsSocialMutationContext,
  socialMutationCompletionBelongsToContext,
} from './PostCommentsScreen';
import { communityFeedBelongsToIdentity, communityPartialRecoveryAction, nextCommunityPage } from './community-state';
import { createPostCompletionBelongsToIdentity } from './CreatePostScreen';
import { reportSheetActionState } from './FeedScreen';
import { communityMutationFailure } from './community-mutation';
import { AxiosError, AxiosHeaders } from 'axios';
import { socialAuthoringActionState } from './social-authoring-state';

describe('community mutation target state', () => {
  it('turns uncertain authoring outcomes into explicit reconciliation actions', () => {
    expect(socialAuthoringActionState('post', 'Hello', false, false, true, true)).toEqual({
      mode: 'recover',
      label: 'Return to community and refresh',
      disabled: false,
      hint: 'Returns to the community feed so you can refresh before posting again.',
    });
    expect(socialAuthoringActionState('comment', 'Amen', false, false, true, true)).toEqual({
      mode: 'recover',
      label: 'Refresh thread to continue',
      disabled: false,
      hint: 'Refreshes the thread to confirm whether your comment was shared.',
    });
    expect(socialAuthoringActionState('comment', 'Amen', true, false, true, true).label)
      .toBe('Reconnect to refresh thread');
    expect(socialAuthoringActionState('post', '', false, false, false, true).label)
      .toBe('Write something to share');
    expect(socialAuthoringActionState('comment', 'Amen', false, true, false, true).label)
      .toBe('Sending your comment…');
  });

  it('locks every report-sheet action while submission is in flight', () => {
    expect(reportSheetActionState(false, false)).toEqual({
      optionDisabled: false,
      cancelDisabled: false,
      submitDisabled: true,
      busy: false,
    });
    expect(reportSheetActionState(true, false).submitDisabled).toBe(false);
    expect(reportSheetActionState(true, true)).toEqual({
      optionDisabled: true,
      cancelDisabled: true,
      submitDisabled: true,
      busy: true,
    });
  });

  it('loads only the next community page while more authoritative rows remain', () => {
    expect(nextCommunityPage(1, 30, 61, false)).toBe(2);
    expect(nextCommunityPage(2, 60, 61, false)).toBe(3);
    expect(nextCommunityPage(2, 61, 61, false)).toBeNull();
    expect(nextCommunityPage(1, 30, 61, true)).toBeNull();
    expect(nextCommunityPage(0, 0, 61, false)).toBeNull();
  });

  it('uses refresh semantics for partial feed and thread recovery', () => {
    expect(communityPartialRecoveryAction(false, 'feed')).toEqual({
      label: 'Refresh community',
      hint: 'Refreshes community posts and reaction status from the newest page.',
      disabled: false,
    });
    expect(communityPartialRecoveryAction(false, 'comments')).toEqual({
      label: 'Refresh thread',
      hint: 'Refreshes comments and mutation status from the first page.',
      disabled: false,
    });
    expect(communityPartialRecoveryAction(true, 'comments')).toEqual({
      label: 'Reconnect to refresh',
      hint: 'Reconnect to refresh this comment thread.',
      disabled: true,
    });
  });
  it('allows comments only after the currently requested thread is confirmed', () => {
    expect(canSubmitCommentToPost('post-1', 'post-1')).toBe(true);
    expect(canSubmitCommentToPost(null, 'post-1')).toBe(false);
    expect(canSubmitCommentToPost('post-1', 'post-2')).toBe(false);
  });

  it('accepts comment finalizers only while the initiating thread remains mounted', () => {
    const active = { postId: 'post-1', churchId: 'church-1', memberId: 'member-1' };
    expect(socialMutationCompletionBelongsToContext(
      true, active, 'post-1', 'church-1', 'member-1',
    )).toBe(true);
    expect(socialMutationCompletionBelongsToContext(
      false, active, 'post-1', 'church-1', 'member-1',
    )).toBe(false);
    expect(socialMutationCompletionBelongsToContext(
      true, { ...active, postId: 'post-2' }, 'post-1', 'church-1', 'member-1',
    )).toBe(false);
  });

  it('accepts create-post completion only for the mounted initiating identity', () => {
    const active = { churchId: 'church-1', memberId: 'member-1' };
    expect(createPostCompletionBelongsToIdentity(
      true, active, 'church-1', 'member-1',
    )).toBe(true);
    expect(createPostCompletionBelongsToIdentity(
      false, active, 'church-1', 'member-1',
    )).toBe(false);
    expect(createPostCompletionBelongsToIdentity(
      true, { ...active, memberId: 'member-2' }, 'church-1', 'member-1',
    )).toBe(false);
  });

  it('accepts a mutation completion only for its initiating member and thread', () => {
    expect(ownsSocialMutationContext(
      { postId: 'post-1', churchId: 'church-1', memberId: 'member-1' }, 'post-1', 'church-1', 'member-1',
    )).toBe(true);
    expect(ownsSocialMutationContext(
      { postId: 'post-2', churchId: 'church-1', memberId: 'member-1' }, 'post-1', 'church-1', 'member-1',
    )).toBe(false);
    expect(ownsSocialMutationContext(
      { postId: 'post-1', churchId: 'church-1', memberId: 'member-2' }, 'post-1', 'church-1', 'member-1',
    )).toBe(false);
    expect(ownsSocialMutationContext(
      { postId: 'post-1', churchId: 'church-2', memberId: 'member-1' }, 'post-1', 'church-1', 'member-1',
    )).toBe(false);
    expect(ownsSocialMutationContext(
      { postId: 'post-1' }, 'post-1', 'church-1', 'member-1',
    )).toBe(false);
  });

  it('renders member reaction state only for its exact feed owner', () => {
    const active = { churchId: 'church-1', memberId: 'member-1' };
    expect(communityFeedBelongsToIdentity(active, active)).toBe(true);
    expect(communityFeedBelongsToIdentity(null, active)).toBe(false);
    expect(communityFeedBelongsToIdentity(
      { churchId: 'church-1', memberId: 'member-2' }, active,
    )).toBe(false);
    expect(communityFeedBelongsToIdentity(
      { churchId: 'church-2', memberId: 'member-1' }, active,
    )).toBe(false);
    expect(communityFeedBelongsToIdentity(active, {})).toBe(false);
  });

  it('requires authoritative refresh after response-less community mutations', () => {
    const timeout = new AxiosError('timeout', 'ECONNABORTED');
    expect(communityMutationFailure('post', timeout)).toMatchObject({
      outcomeUnknown: true,
      title: 'Post status unknown',
      message: expect.stringMatching(/refresh before posting it again/),
    });
    expect(communityMutationFailure('comment', timeout)).toMatchObject({
      outcomeUnknown: true,
      message: expect.stringMatching(/Refresh this thread/),
    });
    expect(communityMutationFailure('reaction', timeout)).toMatchObject({
      outcomeUnknown: true,
      message: expect.stringMatching(/Refresh the community feed/),
    });
    expect(communityMutationFailure('report', timeout)).toMatchObject({
      outcomeUnknown: true,
      title: 'Report status unknown',
      message: expect.stringMatching(/Avoid sending it repeatedly/),
    });
    expect(communityMutationFailure('delete', timeout)).toMatchObject({
      outcomeUnknown: true,
      title: 'Deletion status unknown',
      message: expect.stringMatching(/Refresh the community feed/),
    });
    expect(communityMutationFailure('deleteComment', timeout)).toMatchObject({
      outcomeUnknown: true,
      message: expect.stringMatching(/Refresh this thread/),
    });

    const rejected = new AxiosError(
      'bad request',
      'ERR_BAD_REQUEST',
      { headers: new AxiosHeaders() },
      undefined,
      {
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { error: 'This message is too long.' },
      },
    );
    expect(communityMutationFailure('post', rejected)).toEqual({
      outcomeUnknown: false,
      title: 'Post not shared',
      message: 'This message is too long.',
    });
    expect(communityMutationFailure('comment', rejected).outcomeUnknown).toBe(false);
    expect(communityMutationFailure('reaction', rejected).outcomeUnknown).toBe(false);
    expect(communityMutationFailure('report', rejected).outcomeUnknown).toBe(false);
    expect(communityMutationFailure('delete', rejected).outcomeUnknown).toBe(false);
    expect(communityMutationFailure('deleteComment', rejected).outcomeUnknown).toBe(false);
  });
});
