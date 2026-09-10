<template>
  <div class="buttons">
    <b-button @mousedown="fireSpacebar">Spacebar</b-button>
    <b-button @mousedown="fireEnter">Enter</b-button>
  </div>
</template>

<script lang="ts">
// Shows buttons for submitting timing info, in case of a mobile device without a hardware keyboard

import { defineComponent } from "vue";

export default defineComponent({
  methods: {
    fireSpacebar() {
      this.$emit(
        "keydown",
        new KeyboardEvent("keydown", { code: "Space" })
      );
    },
    fireEnter() {
      this.$emit(
        "keydown",
        new KeyboardEvent("keydown", { code: "Enter" })
      );
    },
  },
});
</script>