<template>
  <div class="buttons">
    <b-button @mousedown="fire(startKey)">{{ startLabel }}</b-button>
    <b-button @mousedown="fire(endKey)">{{ endLabel }}</b-button>
  </div>
</template>

<script lang="ts">
// Shows buttons for submitting timing info, in case of a mobile device without a hardware keyboard

import { PropType, defineComponent } from "vue";
import { KeyBinding, eventKey } from "@/lib/timingKeys";

export default defineComponent({
  props: {
    startKey: { type: Object as PropType<KeyBinding>, required: true },
    endKey: { type: Object as PropType<KeyBinding>, required: true },
    startLabel: { type: String, required: true },
    endLabel: { type: String, required: true },
  },
  methods: {
    fire({ key, code = "", shift = false, ctrl = false }: KeyBinding) {
      const init = { key: eventKey(key), code, shiftKey: shift, ctrlKey: ctrl };
      this.$emit("keydown", new KeyboardEvent("keydown", init));
    },
  },
});
</script>
