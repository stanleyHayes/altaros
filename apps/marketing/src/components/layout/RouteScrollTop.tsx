import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

export default function RouteScrollTop() {
  const { pathname, search } = useLocation();
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = reduced ? "auto" : "smooth";
    window.scrollTo({ top: 0, left: 0, behavior });
    document.querySelector<HTMLElement>("[data-route-scroll-container]")?.scrollTo({ top: 0, left: 0, behavior });
  }, [pathname, search]);

  return null;
}
