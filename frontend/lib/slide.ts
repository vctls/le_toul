// Slides an element open or shut by animating its height.
// CSS can't transition to `height: auto`, so each slide runs between measured heights.
// The element needs a CSS `transition` on `height`.

// The latest slide on each element. A slide that another has overtaken leaves the element alone when it ends.
const latestSlide = new WeakMap<HTMLElement, symbol>();

/**
 * Starts from the element's current height, so reversing a slide midway doesn't jump.
 * A shut element ends up with `display: none`.
 */
export function slide(el: HTMLElement, open: boolean): void {
  const start = el.style.display === "none" ? 0 : el.offsetHeight;
  el.style.display = "";
  el.style.overflow = "hidden";
  el.style.height = `${start}px`;
  const end = open ? el.scrollHeight : 0;

  const id = Symbol();
  latestSlide.set(el, id);
  const finish = () => {
    if (latestSlide.get(el) !== id) {
      return;
    }
    latestSlide.delete(el);
    // Hands the height back to the content, and stops clipping popups such as dropdowns.
    el.style.height = "";
    el.style.overflow = "";
    if (!open) {
      el.style.display = "none";
    }
  };
  if (start === end || !parseFloat(getComputedStyle(el).transitionDuration)) {
    // No transitionend event would ever come.
    finish();
    return;
  }

  // Reading the layout commits the start height, so the next assignment transitions from it.
  void el.offsetHeight;
  el.style.height = `${end}px`;
  const onEnd = (event: TransitionEvent) => {
    // Transitions inside the element bubble up here too.
    if (event.target !== el || event.propertyName !== "height") {
      return;
    }
    el.removeEventListener("transitionend", onEnd);
    finish();
  };
  el.addEventListener("transitionend", onEnd);
}
