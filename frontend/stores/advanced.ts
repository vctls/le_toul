import { defineStore } from "pinia";
import { ref } from "vue";
import { persistJsonRef } from "@/lib/persistence";

// Karaoke Builder Studio files and line display times are only shown in advanced mode.
export const useAdvancedStore = defineStore("advanced", () => {
  const isAdvanced = ref(false);
  persistJsonRef("advanced.isAdvanced", isAdvanced);

  function toggleAdvanced(): void {
    isAdvanced.value = !isAdvanced.value;
  }

  return { isAdvanced, toggleAdvanced };
});
