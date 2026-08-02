export const INLINE_NAME_FIELDS_MIN_WIDTH = 480;

/** Keep name fields readable on compact phones and with enlarged text. */
export function shouldUseInlineRegistrationNameFields(viewportWidth: number): boolean {
  return Number.isFinite(viewportWidth) && viewportWidth >= INLINE_NAME_FIELDS_MIN_WIDTH;
}
