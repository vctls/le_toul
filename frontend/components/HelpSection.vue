<template>
  <b-collapse
      v-model="helpStore.isShowingHelp"
      class="content"
      :class="{'is-collapsed': !helpStore.isShowingHelp}">
    <slot/>
  </b-collapse>
</template>

<script lang="ts">
import {defineComponent} from "vue";
import {useHelpStore} from "@/stores/help";

export default defineComponent({
  setup() {
    return {helpStore: useHelpStore()};
  },
});
</script>

<style scoped>
.content.is-collapsed {
  margin-bottom: 0;
}
</style>
