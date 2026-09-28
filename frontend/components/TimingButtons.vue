<template>
  <div class="buttons">
    <b-button @mousedown="fire(startKey)">{{ startLabel }}</b-button>
    <b-button @mousedown="fire(endKey)">{{ endLabel }}</b-button>
  </div>
</template>

<script lang="ts">
// Shows buttons for submitting timing info, in case of a mobile device without a hardware keyboard

import { defineComponent } from "vue";

export default defineComponent({
  props: {
    startKey: { type: String, required: true },
    endKey: { type: String, required: true },
    startLabel: { type: String, required: true },
    endLabel: { type: String, required: true },
  },
  methods: {
    fire(code: string) {
      this.$emit("keydown", new KeyboardEvent("keydown", { code }));
    },
  },
});
</script>
