import { formKeyboardProps } from './form-keyboard';

describe('mobile form keyboard lifecycle', () => {
  it('tracks iOS keyboard dismissal and protects focused fields from overlap', () => {
    expect(formKeyboardProps('ios')).toEqual({
      automaticallyAdjustKeyboardInsets: true,
      keyboardDismissMode: 'interactive',
      keyboardShouldPersistTaps: 'handled',
    });
  });

  it('dismisses on drag without applying iOS-only inset correction elsewhere', () => {
    expect(formKeyboardProps('android')).toEqual({
      automaticallyAdjustKeyboardInsets: false,
      keyboardDismissMode: 'on-drag',
      keyboardShouldPersistTaps: 'handled',
    });
  });
});
