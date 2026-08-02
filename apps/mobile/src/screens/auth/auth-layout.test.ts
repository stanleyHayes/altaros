import {
  INLINE_NAME_FIELDS_MIN_WIDTH,
  shouldUseInlineRegistrationNameFields,
} from './auth-layout';

describe('responsive authentication layout', () => {
  it.each([320, 360, 390, 430])('stacks name fields on a %spx compact viewport', (width) => {
    expect(shouldUseInlineRegistrationNameFields(width)).toBe(false);
  });

  it('uses the two-column treatment only when each field has enough room', () => {
    expect(shouldUseInlineRegistrationNameFields(INLINE_NAME_FIELDS_MIN_WIDTH - 1)).toBe(false);
    expect(shouldUseInlineRegistrationNameFields(INLINE_NAME_FIELDS_MIN_WIDTH)).toBe(true);
    expect(shouldUseInlineRegistrationNameFields(768)).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('fails compact for invalid width %s', (width) => {
    expect(shouldUseInlineRegistrationNameFields(width)).toBe(false);
  });
});
