/** True when the touch started on something that uses sideways movement itself (text, sliders, players, scrolling strips): a swipe there is not a page swipe. */
export function usesSideways(element: Element | null): boolean {
  for (let e = element; e && e !== document.body; e = e.parentElement) {
    if (e.matches('input, textarea, select, button, a, audio, video, iframe, [contenteditable], [role="slider"]')) return true;
    if (e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(e).overflowX)) return true;
  }
  return false;
}

/** A quick, mostly horizontal, long enough movement: the sideways distance (negative = to the left), or 0 when it is not a swipe. */
export function swipeOf(start: { x: number; y: number; time: number }, end: { clientX: number; clientY: number }): number {
  const dx = end.clientX - start.x;
  const dy = end.clientY - start.y;
  if (Date.now() - start.time > 700 || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8) return 0;
  return dx;
}
