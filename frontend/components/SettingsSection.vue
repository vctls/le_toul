<template>
  <div class="card settings-section">
    <button
      type="button"
      class="card-header"
      :aria-controls="id"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="card-header-title">
        <b-icon class="chevron" icon="angle-right"></b-icon>
        {{ title }}
      </span>
    </button>
    <div :id="id" ref="body" class="settings-section-body">
      <div class="card-content">
        <slot />
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { slide } from "@/lib/slide";

/**
 * A titled group of settings, collapsed until its header is clicked.
 */
export default defineComponent({
  props: {
    title: { type: String, required: true },
    id: { type: String, required: true },
  },
  data() {
    return { open: false };
  },
  mounted() {
    (this.$refs.body as HTMLElement).style.display = "none";
  },
  watch: {
    open(open: boolean) {
      slide(this.$refs.body as HTMLElement, open);
    },
  },
});
</script>

<style scoped>
.settings-section {
  margin-top: 1rem;
  border: 1px solid var(--bulma-border);
  border-radius: var(--bulma-radius);
  box-shadow: none;
}

.settings-section:has(> .card-header:hover) {
  border-color: var(--bulma-border-hover);
}

.card-header {
  width: 100%;
  border: none;
  padding: 0;
  font: inherit;
  text-align: start;
  cursor: pointer;
  box-shadow: none;
}

.card-header-title {
  gap: 0.25rem;
  padding: calc(0.5em - 1px) calc(0.75em - 1px);
}

.chevron {
  transition: transform 250ms ease;
}

.card-header[aria-expanded="true"] .chevron {
  transform: rotate(90deg);
}

.settings-section-body {
  transition: height 250ms ease;
}

.card-content {
  padding: 0 calc(0.75em - 1px) 0.75rem;
}

/* With no transition, slide() snaps the section to its end state. */
@media (prefers-reduced-motion: reduce) {
  .settings-section-body,
  .chevron {
    transition: none;
  }
}
</style>
