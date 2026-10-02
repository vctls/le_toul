<template>
  <b-dropdown
    append-to-body
    ariaRole="dialog"
    position="is-bottom-left"
    scrollable
    max-height="20rem"
    @active-change="loadSymbolFont"
  >
    <template #trigger>
      <b-button icon-left="shapes" :aria-label="label" :title="label" />
    </template>
    <b-dropdown-item custom :focusable="false">
      <div v-for="group in groups" :key="group.name" class="symbol-group">
        <p class="symbol-group-name">{{ group.name }}</p>
        <div class="symbol-grid">
          <button
            v-for="symbol in group.symbols"
            :key="symbol.char"
            type="button"
            class="button symbol"
            :title="symbol.name"
            :aria-label="symbol.name"
            :style="{ fontFamily: symbolFont }"
            @click="$emit('pick', symbol.char)"
          >
            {{ symbol.char }}
          </button>
        </div>
      </div>
    </b-dropdown-item>
  </b-dropdown>
</template>

<script lang="ts">
/* A dropdown of symbols to insert into a text field. */

import { defineComponent, PropType } from "vue";
import { BButton, BDropdown, BDropdownItem } from "buefy";
import { BUNDLED_FONTS, SYMBOL_FONT } from "@/lib/fonts";

let symbolFontAdded = false;

/**
 * Let the page draw the symbols with the font the video falls back to,
 * so they look as they will in the video, not as the system draws them.
 */
function loadSymbolFont() {
  if (symbolFontAdded || typeof FontFace === "undefined") {
    return;
  }
  document.fonts.add(new FontFace(SYMBOL_FONT, `url(${BUNDLED_FONTS[SYMBOL_FONT]})`));
  symbolFontAdded = true;
}

export default defineComponent({
  components: { BButton, BDropdown, BDropdownItem },
  props: {
    groups: {
      type: Array as PropType<
        readonly { name: string; symbols: readonly { char: string; name: string }[] }[]
      >,
      required: true,
    },
    label: { type: String, default: "Insert a symbol" },
  },
  emits: ["pick"],
  data() {
    return { symbolFont: SYMBOL_FONT };
  },
  methods: { loadSymbolFont },
});
</script>

<style scoped>
.symbol-group + .symbol-group {
  margin-top: 0.5rem;
}

.symbol-group-name {
  font-size: 0.75rem;
  margin-bottom: 0.25rem;
}

.symbol-grid {
  display: grid;
  grid-template-columns: repeat(8, 2.25rem);
  gap: 0.25rem;
}

.symbol {
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  font-size: 1.1rem;
}
</style>
