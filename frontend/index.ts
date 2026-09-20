import { createApp } from "vue";
import Buefy from "buefy";
import { createPinia } from "pinia";
import { setupErrorHandling } from "@/lib/util";
import App from "@/App.vue";
import "@/main.scss";
import { useTimingsStore } from "@/stores/timings";
import { applyThemePreference, loadThemePreference } from "@/lib/colorScheme";

// Import our optimized FontAwesome configuration
import FontAwesomeIcon from "./plugins/fontawesome";

// Set error handling
const logError = setupErrorHandling();

// Ahead of the `load` handler below:
// a forced theme has to reach the root element before the first paint, not once the app mounts.
applyThemePreference(loadThemePreference());

window.addEventListener("load", function () {
  const pinia = createPinia();
  const app = createApp(App);
  app.use(pinia);
  app.use(Buefy, {
    defaultIconPack: "fas",
    defaultIconComponent: "font-awesome-icon",
  });
  app.config.errorHandler = logError;
  app.component("font-awesome-icon", FontAwesomeIcon);

  // Options stores can't auto-wire persistence via watch() inside setup, so
  // register the timings store's $subscribe hook once Pinia is active.
  useTimingsStore().setupPersistence();
  // Same for the watchers that carry timings across voice renames and lyric edits.
  useTimingsStore().setupVoiceReconciliation();
  useTimingsStore().setupSegmentReconciliation();

  app.mount("#app");
});
