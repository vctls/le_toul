import { Ref, ref, onScopeDispose } from "vue";

export function isMobile() {
  // True if we're on a phone or tablet
  return window.screen.width <= 820;
}

export function usePrefersReducedMotion(): Ref<boolean> {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  const prefersReducedMotion = ref(query.matches);

  function update(event: MediaQueryListEvent): void {
    prefersReducedMotion.value = event.matches;
  }

  query.addEventListener("change", update);
  onScopeDispose(() => query.removeEventListener("change", update));

  return prefersReducedMotion;
}
