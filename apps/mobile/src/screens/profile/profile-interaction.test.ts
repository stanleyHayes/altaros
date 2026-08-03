import {
  installedVersionLabel,
  ownsMountedProfileAction,
  ownsProfileIdentity,
  profileExternalActionState,
  profileSessionActionState,
} from './ProfileScreen';

describe('profile action lifecycle', () => {
  it('accepts a delayed account action only for its initiating identity', () => {
    expect(ownsProfileIdentity(
      { churchId: 'church-1', memberId: 'member-1' }, 'church-1', 'member-1',
    )).toBe(true);
    expect(ownsProfileIdentity(
      { churchId: 'church-2', memberId: 'member-1' }, 'church-1', 'member-1',
    )).toBe(false);
    expect(ownsProfileIdentity(
      { churchId: 'church-1', memberId: 'member-2' }, 'church-1', 'member-1',
    )).toBe(false);
    expect(ownsProfileIdentity({}, 'church-1', 'member-1')).toBe(false);
  });

  it('rejects a delayed completion after unmount or account replacement', () => {
    expect(ownsMountedProfileAction(
      true, { churchId: 'church-1', memberId: 'member-1' }, 'church-1', 'member-1',
    )).toBe(true);
    expect(ownsMountedProfileAction(
      false, { churchId: 'church-1', memberId: 'member-1' }, 'church-1', 'member-1',
    )).toBe(false);
    expect(ownsMountedProfileAction(
      true, { churchId: 'church-1', memberId: 'member-2' }, 'church-1', 'member-1',
    )).toBe(false);
  });

  it('closes external profile actions while offline or another page is opening', () => {
    const privacy = 'https://altaros.com/privacy';
    const help = 'https://altaros.com/help';
    expect(profileExternalActionState(privacy, false, null)).toEqual({ disabled: false, busy: false });
    expect(profileExternalActionState(privacy, true, null)).toMatchObject({
      disabled: true, busy: false, hint: 'Reconnect to open this page.',
    });
    expect(profileExternalActionState(privacy, false, privacy)).toMatchObject({
      disabled: true, busy: true, hint: 'Opening this page on your device.',
    });
    expect(profileExternalActionState(help, false, privacy)).toMatchObject({
      disabled: true, busy: false, hint: 'Wait for the current page to open.',
    });
  });

  it('shows installed package metadata instead of a stale hard-coded release', () => {
    expect(installedVersionLabel(' 1.4.2 ', ' 37 ')).toBe('ALTAR OS · 1.4.2 (37)');
    expect(installedVersionLabel(null, null, '1.0.0')).toBe('ALTAR OS · 1.0.0');
    expect(installedVersionLabel('1.4.2\nspoofed', '37')).toBe('ALTAR OS · 1.0.0 (37)');
    expect(installedVersionLabel(null, null, '')).toBe('ALTAR OS · Unknown version');
  });

  it('keeps local sign-out available offline but closes both paths during global revocation', () => {
    expect(profileSessionActionState(true, false)).toEqual({
      local: {
        disabled: false,
        hint: 'Signs out this device immediately, including while offline.',
      },
      global: {
        disabled: true,
        busy: false,
        hint: 'Reconnect to end your sessions on every device.',
      },
    });
    expect(profileSessionActionState(false, true)).toEqual({
      local: { disabled: true, hint: 'Wait while every session is being ended.' },
      global: { disabled: true, busy: true, hint: 'Every session is being ended.' },
    });
  });
});
