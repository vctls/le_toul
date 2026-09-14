import { defineStore } from 'pinia';
import { ref } from 'vue';
import { isMobile } from '@/lib/device';
import { persistJsonRef } from '@/lib/persistence';

export const useHelpStore = defineStore('help', () => {
  // Collapsed by default on mobile, where the instructions push the controls off-screen.
  const isShowingHelp = ref(!isMobile());
  persistJsonRef('help.isShowingHelp', isShowingHelp);

  function toggleHelp(): void {
    isShowingHelp.value = !isShowingHelp.value;
  }

  return { isShowingHelp, toggleHelp };
});
