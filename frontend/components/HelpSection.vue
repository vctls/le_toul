<template>
  <div
    class="help-section content"
    :class="{ 'is-collapsed': !helpStore.isShowingHelp }"
    :inert="!helpStore.isShowingHelp"
  >
    <div class="help-body">
      <slot />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { useHelpStore } from "@/stores/help";

export default defineComponent({
  setup() {
    return { helpStore: useHelpStore() };
  },
});
</script>

<style scoped>
/* A grid row can animate between its content's height and none, which height itself can't,
so the content below slides up and down with it instead of jumping once it is gone. */
.help-section {
  --help-transition: 0.25s ease;
  display: grid;
  grid-template-rows: 1fr;
  transition:
    grid-template-rows var(--help-transition),
    margin-bottom var(--help-transition);
}

/* Hidden only once it has closed, so it stays visible while it shrinks. */
.help-section.is-collapsed {
  grid-template-rows: 0fr;
  margin-bottom: 0;
  visibility: hidden;
  transition:
    grid-template-rows var(--help-transition),
    margin-bottom var(--help-transition),
    visibility 0s 0.25s;
}

.help-body {
  min-height: 0;
  overflow: hidden;
}

@media (prefers-reduced-motion: reduce) {
  .help-section,
  .help-section.is-collapsed {
    transition: none;
  }
}
</style>
