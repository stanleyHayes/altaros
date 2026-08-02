import { routeScrollShouldAnimate, scrollRouteTargetToTop } from './useAnimatedRouteTop';

describe('route scroll reset', () => {
  it('animates ScrollView-compatible targets to the top', () => {
    const scrollTo = jest.fn();
    scrollRouteTargetToTop({ scrollTo });
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  });

  it('animates FlatList-compatible targets to offset zero', () => {
    const scrollToOffset = jest.fn();
    scrollRouteTargetToTop({ scrollToOffset });
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
  });

  it('turns off motion when the operating system requests reduced motion', () => {
    expect(routeScrollShouldAnimate(false)).toBe(true);
    expect(routeScrollShouldAnimate(true)).toBe(false);
    const scrollTo = jest.fn();
    scrollRouteTargetToTop({ scrollTo }, false);
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
  });

  it('prefers the ScrollView contract and safely ignores an absent target', () => {
    const scrollTo = jest.fn();
    const scrollToOffset = jest.fn();
    scrollRouteTargetToTop({ scrollTo, scrollToOffset });
    scrollRouteTargetToTop(null);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).not.toHaveBeenCalled();
  });
});
