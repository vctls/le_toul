<template>
  <div class="buttons">
    <b-button @mousedown="fire(startKey)">{{ formatKeyName(startKey) }}</b-button>
    <b-button @mousedown="fire(endKey)">{{ formatKeyName(endKey) }}</b-button>
  </div>
</template>

<script lang="ts">
// Shows buttons for submitting timing info, in case of a mobile device without a hardware keyboard

import { defineComponent } from "vue";
import { formatKeyName } from "@/lib/timingKeys";

export default defineComponent({
  props: {
    startKey: { type: String, required: true },
    endKey: { type: String, required: true },
  },
  methods: {
    formatKeyName,
    fire(code: string) {
      this.$emit("keydown", new KeyboardEvent("keydown", { code }));
    },
  },
});
</script>
