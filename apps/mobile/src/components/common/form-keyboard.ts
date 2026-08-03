import type { ScrollViewProps } from 'react-native';

type FormKeyboardProps = Pick<
  ScrollViewProps,
  'automaticallyAdjustKeyboardInsets' | 'keyboardDismissMode' | 'keyboardShouldPersistTaps'
>;

/** Shared keyboard behavior for long, scrollable member forms. */
export function formKeyboardProps(platform: string): FormKeyboardProps {
  return {
    automaticallyAdjustKeyboardInsets: platform === 'ios',
    keyboardDismissMode: platform === 'ios' ? 'interactive' : 'on-drag',
    keyboardShouldPersistTaps: 'handled',
  };
}
