import { useCallback, useContext, useEffect, useRef, type RefObject } from 'react';
import { AccessibilityInfo } from 'react-native';
import { NavigationContext, useFocusEffect } from '@react-navigation/native';

export type RouteScrollTarget =
  | { scrollTo: (options: { x?: number; y?: number; animated?: boolean }) => void }
  | { scrollToOffset: (options: { offset: number; animated?: boolean }) => void };

export function routeScrollShouldAnimate(reduceMotionEnabled: boolean): boolean {
  return !reduceMotionEnabled;
}

export function scrollRouteTargetToTop(
  target: RouteScrollTarget | null,
  animated = true,
): void {
  if (target && 'scrollTo' in target) {
    target.scrollTo({ y: 0, animated });
  } else {
    target?.scrollToOffset({ offset: 0, animated });
  }
}

/**
 * Resets a primary route after it receives focus and when its active tab is
 * pressed again. The frame boundary lets navigation begin its own transition
 * before the scroll animation, and cancellation prevents a superseded route
 * from moving after focus has already changed again.
 */
export function useAnimatedRouteTop(ref: RefObject<RouteScrollTarget | null>): void {
  const navigation = useContext(NavigationContext);
  const revisionRef = useRef(0);
  const frameRef = useRef<number | null>(null);

  const cancelPendingReset = useCallback(() => {
    revisionRef.current += 1;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const scheduleReset = useCallback(() => {
    cancelPendingReset();
    const revision = revisionRef.current;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      void AccessibilityInfo.isReduceMotionEnabled()
        .catch(() => false)
        .then((reduceMotionEnabled) => {
          if (revision === revisionRef.current) {
            scrollRouteTargetToTop(
              ref.current,
              routeScrollShouldAnimate(reduceMotionEnabled),
            );
          }
        });
    });
  }, [cancelPendingReset, ref]);

  useFocusEffect(useCallback(() => {
    scheduleReset();
    return cancelPendingReset;
  }, [cancelPendingReset, scheduleReset]));

  useEffect(() => {
    if (!navigation) return undefined;
    // `tabPress` is supplied by the nearest bottom-tab navigator, but it is
    // intentionally absent from the framework's navigator-agnostic type.
    const unsubscribe = navigation.addListener('tabPress' as never, (() => {
      if (navigation.isFocused()) scheduleReset();
    }) as never);
    return () => {
      unsubscribe();
      cancelPendingReset();
    };
  }, [cancelPendingReset, navigation, scheduleReset]);
}
