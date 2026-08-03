import { apiErrorMessage, isAmbiguousMutationFailure } from '../../services/api-error';

export type CommunityMutationKind = 'post' | 'comment' | 'reaction' | 'report' | 'delete' | 'deleteComment';

export function communityMutationFailure(
  kind: CommunityMutationKind,
  error: unknown,
): { outcomeUnknown: boolean; title: string; message: string } {
  if (isAmbiguousMutationFailure(error)) {
    if (kind === 'post') {
      return {
        outcomeUnknown: true,
        title: 'Post status unknown',
        message: 'We could not confirm whether your post was shared. Return to the community feed and refresh before posting it again.',
      };
    }
    if (kind === 'comment') {
      return {
        outcomeUnknown: true,
        title: 'Comment status unknown',
        message: 'We could not confirm whether your comment was shared. Refresh this thread before sending it again.',
      };
    }
    if (kind === 'report') {
      return {
        outcomeUnknown: true,
        title: 'Report status unknown',
        message: 'We could not confirm whether moderators received this report. Avoid sending it repeatedly; your church team may already have it.',
      };
    }
    if (kind === 'delete') {
      return {
        outcomeUnknown: true,
        title: 'Deletion status unknown',
        message: 'We could not confirm whether your post was deleted. Refresh the community feed before trying to remove it again.',
      };
    }
    if (kind === 'deleteComment') {
      return {
        outcomeUnknown: true,
        title: 'Deletion status unknown',
        message: 'We could not confirm whether your comment was deleted. Refresh this thread before trying to remove it again.',
      };
    }
    return {
      outcomeUnknown: true,
      title: 'Reaction status unknown',
      message: 'We could not confirm your reaction. Refresh the community feed before changing it again.',
    };
  }

  if (kind === 'post') {
    return {
      outcomeUnknown: false,
      title: 'Post not shared',
      message: apiErrorMessage(error, 'Check your connection and try again.'),
    };
  }
  if (kind === 'comment') {
    return {
      outcomeUnknown: false,
      title: 'Comment not shared',
      message: apiErrorMessage(error, 'Check your connection and try again.'),
    };
  }
  if (kind === 'report') {
    return {
      outcomeUnknown: false,
      title: 'Report not sent',
      message: apiErrorMessage(error, 'We could not send this report. Try again.'),
    };
  }
  if (kind === 'delete') {
    return {
      outcomeUnknown: false,
      title: 'Post not deleted',
      message: apiErrorMessage(error, 'We could not delete this post. Try again.'),
    };
  }
  if (kind === 'deleteComment') {
    return {
      outcomeUnknown: false,
      title: 'Comment not deleted',
      message: apiErrorMessage(error, 'We could not delete this comment. Try again.'),
    };
  }
  return {
    outcomeUnknown: false,
    title: 'Reaction not saved',
    message: 'Your reaction was not saved. Try again.',
  };
}
