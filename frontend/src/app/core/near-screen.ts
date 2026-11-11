/**
 * Calls `onNear` once, when `element` is on the screen or within one screen height above or below it (a picture that is far away in the
 * feed is not read yet). Returns the function that stops the watching. A browser without IntersectionObserver calls it at once.
 */
export function whenNearScreen(element: Element, onNear: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    onNear();
    return () => undefined;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      onNear();
    },
    { rootMargin: '100% 0px' },
  );
  observer.observe(element);
  return () => observer.disconnect();
}
