import { Workbox } from "workbox-window";

/**
 * Register the service worker, and call onUpdate when a new version is waiting to take over.
 * The function it receives switches to that version and reloads the page.
 */
export function registerServiceWorker(onUpdate: (activate: () => void) => void): void {
  const workbox = new Workbox("/sw.js");
  workbox.addEventListener("waiting", () => {
    onUpdate(() => {
      workbox.addEventListener("controlling", () => window.location.reload());
      workbox.messageSkipWaiting();
    });
  });
  workbox.register().catch((error) => console.warn("Service worker registration failed", error));
}
