import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const PAGE_TIMEOUT_MS = 4000;
// Hosts answer with these while the app is down, rather than refusing the connection.
const UNAVAILABLE_STATUSES = [502, 503, 504];

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

clientsClaim();
cleanupOutdatedCaches();

/**
 * Serve the server's page, or this worker's own copy when the server is unreachable or down.
 * The fallback is the precached copy rather than the last page seen, since only that one is
 * guaranteed to name bundle files this worker holds.
 */
async function fetchPage(request: Request): Promise<Response> {
  const network = fetch(request);
  const timeout = new Promise<undefined>((resolve) => setTimeout(resolve, PAGE_TIMEOUT_MS));
  const response = await Promise.race([network.catch(() => undefined), timeout]);
  if (response && !UNAVAILABLE_STATUSES.includes(response.status)) {
    return response;
  }
  return (await matchPrecache("/")) ?? network;
}

// Registered ahead of the precache route, which would otherwise serve "/" cache-first.
registerRoute(
  ({ request, url }) => request.mode === "navigate" && url.pathname === "/",
  ({ request }) => fetchPage(request),
);

precacheAndRoute(self.__WB_MANIFEST);
