import { memberTabLayout, memberTabPresentation } from './MemberTabBar';

describe('member tab presentation', () => {
  it('uses the product-facing Social label and selected icon', () => {
    expect(memberTabPresentation('Community', true)).toEqual({
      label: 'Social',
      icon: 'people',
    });
    expect(memberTabPresentation('Community', false)).toEqual({
      label: 'Social',
      icon: 'people-outline',
    });
  });

  it('provides a safe presentation for every member tab', () => {
    expect(['Home', 'Give', 'Community', 'Events', 'Profile'].map(
      (name) => memberTabPresentation(name, false).label,
    )).toEqual(['Home', 'Give', 'Social', 'Events', 'Profile']);
    expect(memberTabPresentation('Unknown', false)).toEqual({
      label: 'Home',
      icon: 'home-outline',
    });
  });

  it('protects compact Android widths without shrinking the touch targets', () => {
    expect(memberTabLayout(320, 1)).toMatchObject({
      compact: true,
      dockPaddingHorizontal: 8,
      railMinHeight: 72,
      tabMinHeight: 58,
      iconWellWidth: 34,
    });
    expect(memberTabLayout(360, 1).compact).toBe(false);
  });

  it('grows the dock for large system text', () => {
    expect(memberTabLayout(360, 1.3)).toMatchObject({
      railMinHeight: 80,
      tabMinHeight: 66,
      labelMarginTop: 4,
    });
  });
});
