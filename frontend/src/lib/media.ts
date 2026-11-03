import { useEffect, useState } from "react";

/** Whether a CSS media query matches, kept up to date as it changes. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Mouse-wheel scrolling that glides to a stop, as on akukolabs.com (Locomotive Scroll, easing 0.1 a frame at 60 Hz).
 *  The page keeps its real scroll position, so the sticky header and tabs, scroll-linked animations and links work as
 *  before. Keys, touch and the scrollbar stay native, and so does a wheel turn that something under the pointer uses
 *  itself (a scroll box with room left, a 3D view that zooms), a pinch, a sideways scroll, or a page that cannot
 *  scroll (the open phone menu). Reduced motion turns it off. */
export function useSmoothWheel() {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  useEffect(() => {
    if (reduced) return;
    const root = document.documentElement;
    let target = 0, current = 0, frame = 0, last = 0;
    const step = (now: number) => {
      // something else moved the page (the scrollbar, find in page, a jump to a result): stop and let it
      if (Math.abs(window.scrollY - current) > 2) return void (frame = 0);
      current += (target - current) * (1 - 0.9 ** (Math.max(0, now - last) / (1000 / 60)));
      last = now;
      if (Math.abs(target - current) < 0.5) current = target;
      window.scrollTo(0, current);
      frame = current === target ? 0 : requestAnimationFrame(step);
    };
    const onWheel = (e: WheelEvent) => {
      // Left to the browser: a modifier (Shift scrolls sideways and Alt goes back in Firefox), a sideways scroll, a
      // pinch-zoomed page (the wheel pans the zoomed view), a page that cannot scroll, and anything under the pointer
      // that takes the wheel itself
      if (e.defaultPrevented || e.ctrlKey || e.shiftKey || e.altKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if ((window.visualViewport?.scale ?? 1) > 1.01 || getComputedStyle(root).overflowY === "hidden" || takesWheel(e)) return;
      e.preventDefault();
      if (!frame) {
        target = current = window.scrollY;
        last = performance.now();
        // start from wherever the page is by the first frame, in case a smooth scroll was still moving it
        frame = requestAnimationFrame((now) => {
          target += window.scrollY - current;
          current = window.scrollY;
          step(now);
        });
      }
      const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1);
      target = Math.max(0, Math.min(root.scrollHeight - window.innerHeight, target + px));
    };
    stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", stop);   // a key's own scroll (Page Down, Space, arrows) starts smooth and late
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", stop);
      stop();
      stop = () => {};
    };
  }, [reduced]);
}

let stop = () => {};

/** Ends a wheel glide in progress. Call it right before the app scrolls the page smoothly itself: a smooth scroll only
 *  starts moving a frame later, and the glide's next step would cancel it. */
export function stopGlide() {
  stop();
}

/** Whether something under the pointer takes this wheel turn itself: a focused number field (Chrome and Edge step its
 *  value), or a box that scrolls and has room left in that direction. */
function takesWheel(e: WheelEvent) {
  if (e.target instanceof HTMLInputElement && e.target.type === "number" && e.target === document.activeElement) return true;
  for (let el = e.target as Element | null; el && el !== document.body; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight
      && (e.deltaY < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1)) return true;
  }
  return false;
}

/** Smooth scrolling, unless the reader asked for less motion. */
export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
