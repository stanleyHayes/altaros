export type SocialAuthoringKind = 'post' | 'comment';

export function socialAuthoringActionState(
  kind: SocialAuthoringKind,
  content: string,
  offline: boolean,
  busy: boolean,
  outcomeUnknown: boolean,
  targetReady: boolean,
) {
  const post = kind === 'post';
  const hasContent = Boolean(content.trim());
  const recoveryDisabled = !post && (offline || busy);
  return {
    mode: outcomeUnknown ? 'recover' : 'submit',
    label: outcomeUnknown
      ? post ? 'Return to community and refresh'
        : busy ? 'Refreshing thread…'
          : offline ? 'Reconnect to refresh thread' : 'Refresh thread to continue'
      : busy ? post ? 'Sharing your post…' : 'Sending your comment…'
        : offline ? post ? 'Reconnect to share your post' : 'Reconnect to send your comment'
          : !targetReady ? post ? 'Sign in again to post' : 'Load thread to comment'
            : !hasContent ? post ? 'Write something to share' : 'Write a comment' : post ? 'Post' : 'Send',
    disabled: outcomeUnknown
      ? recoveryDisabled
      : offline || busy || !targetReady || !hasContent,
    hint: outcomeUnknown
      ? post
        ? 'Returns to the community feed so you can refresh before posting again.'
        : offline ? 'Reconnect to refresh this thread before sending again.'
          : 'Refreshes the thread to confirm whether your comment was shared.'
      : offline ? post ? 'Reconnect to share this post.' : 'Reconnect to share this comment.'
        : !targetReady ? post ? 'Your member session is incomplete. Sign in again.' : 'Load this comment thread before sharing a response.'
          : !hasContent ? post ? 'Write a post before sharing it.' : 'Write a comment before sending it.'
            : undefined,
  } as const;
}
