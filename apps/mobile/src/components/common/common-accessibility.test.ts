import { getInitials, isSafeAvatarUri } from './Avatar';
import { mergeInputAccessibility, passwordVisibilityState } from './Input';
import { Button } from './Button';
import { LoadingScreen } from './LoadingScreen';
import { StatePanel } from './StatePanel';
import { APP_RECOVERY_MESSAGE, AppErrorFallback } from './AppErrorBoundary';
import { paginationActionState } from './pagination-action';

describe('shared pagination recovery', () => {
  it('makes offline, refresh-owned, and loading states visible', () => {
    expect(paginationActionState('older gifts', {
      offline: true, loading: false, refreshing: false, requiresRefresh: false,
    })).toEqual({
      label: 'Reconnect to load older gifts',
      disabled: true,
      busy: false,
      hint: 'Reconnect to load older gifts.',
    });
    expect(paginationActionState('older gifts', {
      offline: false, loading: true, refreshing: false, requiresRefresh: false,
    }).label)
      .toBe('Loading older gifts…');
    expect(paginationActionState('older gifts', {
      offline: false, loading: false, refreshing: true, requiresRefresh: false,
    }).label)
      .toBe('Refresh in progress…');
    expect(paginationActionState('older gifts', {
      offline: false, loading: false, refreshing: false, requiresRefresh: true,
    }).label)
      .toBe('Refresh to continue');
  });
});

describe('shared button accessibility', () => {
  it('announces why an offline action is unavailable', () => {
    const button = Button({
      title: 'Submit',
      onPress: jest.fn(),
      disabled: true,
      accessibilityHint: 'Reconnect to send this request.',
    });
    expect(button.props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(button.props.accessibilityHint).toBe('Reconnect to send this request.');
  });
});

describe('shared loading accessibility', () => {
  it('announces a default account-loading state without exposing a duplicate spinner', () => {
    const loading = LoadingScreen({});
    expect(loading.props).toMatchObject({
      accessible: true,
      accessibilityRole: 'progressbar',
      accessibilityLabel: 'Loading your member account',
      accessibilityLiveRegion: 'polite',
    });
    expect(loading.props.children[0].props.importantForAccessibility).toBe('no');
  });

  it('uses specific visible loading copy as the announcement', () => {
    expect(LoadingScreen({ message: 'Restoring your session' }).props.accessibilityLabel)
      .toBe('Restoring your session');
  });
});

describe('global recovery accessibility', () => {
  it('keeps the recovery action outside the announced error node', () => {
    const fallback = AppErrorFallback({ onRecover: jest.fn() });
    expect(fallback.props.accessibilityRole).toBeUndefined();
    expect(fallback.props.children[2].props).toMatchObject({
      accessibilityRole: 'header',
      accessibilityLiveRegion: 'assertive',
    });
    expect(fallback.props.children[4].type).toBe(Button);
  });

  it('does not promise an unknown payment outcome is safe to retry', () => {
    const fallback = AppErrorFallback({ onRecover: jest.fn() });
    expect(fallback.props.children[3].props.children).toBe(APP_RECOVERY_MESSAGE);
    expect(APP_RECOVERY_MESSAGE).toContain('check your giving history before trying again');
    expect(APP_RECOVERY_MESSAGE).not.toContain('payment details are still safe');
  });
});

describe('shared input accessibility', () => {
  it('gives password visibility controls truthful native state and copy', () => {
    expect(passwordVisibilityState(true, false)).toEqual({
      secureTextEntry: true,
      label: 'Show password',
      hint: 'Reveals the password in this field.',
    });
    expect(passwordVisibilityState(true, true)).toEqual({
      secureTextEntry: false,
      label: 'Hide password',
      hint: 'Masks the password in this field.',
    });
    expect(passwordVisibilityState(false, false).secureTextEntry).toBeUndefined();
  });

  it('preserves caller state while adding the effective disabled state', () => {
    expect(mergeInputAccessibility({ busy: true, disabled: true }, true, undefined, undefined))
      .toEqual({ state: { busy: true, disabled: true }, hint: undefined });
    expect(mergeInputAccessibility({ selected: true }, false, 'Account email', undefined))
      .toEqual({ state: { selected: true, disabled: true }, hint: 'Account email' });
  });

  it('keeps the caller hint and appends the visible validation error', () => {
    expect(mergeInputAccessibility(undefined, true, 'Use your church email', 'Email is required'))
      .toEqual({
        state: { disabled: false },
        hint: 'Use your church email. Error: Email is required',
      });
  });
});

describe('shared member state panel', () => {
  it('announces recovery copy and exposes a full-size disabled action', () => {
    const panel = StatePanel({
      icon: 'cloud-offline-outline',
      tone: 'offline',
      title: 'Events need a connection',
      message: 'You are offline.',
      actionLabel: 'Reconnect to retry',
      actionHint: 'Reconnect to load events.',
      actionDisabled: true,
      onAction: jest.fn(),
    });
    const card = panel.props.children;
    const children = card.props.children;
    expect(children[2].props.accessibilityRole).toBe('header');
    expect(children[3].props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'polite',
    });
    expect(children[4].props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: 'Reconnect to retry',
      accessibilityHint: 'Reconnect to load events.',
      accessibilityState: { disabled: true },
      disabled: true,
    });
  });

  it('keeps a quiet empty state out of assertive announcements', () => {
    const panel = StatePanel({
      icon: 'checkmark-done-outline',
      title: 'You are all caught up',
      message: 'New messages will appear here.',
    });
    const message = panel.props.children.props.children[3];
    expect(message.props.accessibilityRole).toBeUndefined();
    expect(panel.props.children.props.children[4]).toBeNull();
  });
});

describe('shared avatar fallback', () => {
  it('builds stable initials across whitespace and unnamed profiles', () => {
    expect(getInitials('  Ama   Mensah  ')).toBe('AM');
    expect(getInitials('Kojo')).toBe('K');
    expect(getInitials('   ')).toBe('M');
  });

  it('accepts only bounded remote image URLs without embedded credentials', () => {
    expect(isSafeAvatarUri('https://cdn.example/ama.jpg')).toBe(true);
    expect(isSafeAvatarUri('http://localhost:3000/avatar.png')).toBe(true);
    expect(isSafeAvatarUri('file:///private/avatar.jpg')).toBe(false);
    expect(isSafeAvatarUri('data:image/png;base64,abc')).toBe(false);
    expect(isSafeAvatarUri('https://user:secret@cdn.example/avatar.jpg')).toBe(false);
    expect(isSafeAvatarUri(`https://cdn.example/${'a'.repeat(2_100)}`)).toBe(false);
  });
});
