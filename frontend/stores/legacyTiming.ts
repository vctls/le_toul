import { defineStore } from "pinia";
import { ref } from "vue";
import { persistJsonRef } from "@/lib/persistence";

// The old Timing tab is hidden unless the user asks for it, since the Timing tab's Tap mode does its
// job.
export const useLegacyTimingStore = defineStore("legacyTiming", () => {
  const isShown = ref(false);
  persistJsonRef("legacyTiming.isShown", isShown);
  return { isShown };
});
