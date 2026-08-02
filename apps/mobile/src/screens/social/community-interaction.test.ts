import {
  canSubmitCommentToPost,
  ownsSocialMutationContext,
  socialMutationCompletionBelongsToContext,
} from './PostCommentsScreen';
import { communityFeedBelongsToIdentity } from './community-state';
import { createPostCompletionBelongsToIdentity } from './CreatePostScreen';

describe('community mutation target state', () => {
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
});
