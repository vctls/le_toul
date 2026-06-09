<template>
  <div class="voice-style-settings">
    <p class="voice-style-intro">
      Each voice uses the styles above by default. Turn on a custom style to override the
      font, weight, or colors for that voice.
    </p>
    <voice-style-row v-for="voice in voices" :key="voice" :voice="voice" :fonts="fonts" />
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { storeToRefs } from "pinia";
import VoiceStyleRow from "@/components/VoiceStyleRow.vue";
import { useLyricsStore } from "@/stores/lyrics";

export default defineComponent({
  components: { VoiceStyleRow },
  props: {
    fonts: {
      type: Object as PropType<Record<string, string>>,
      required: true,
    },
  },
  setup() {
    const lyricsStore = useLyricsStore();
    const { voices } = storeToRefs(lyricsStore);
    return { voices };
  },
});
</script>

<style scoped>
.voice-style-intro {
  font-size: 0.9rem;
  margin-bottom: 0.75rem;
}
</style>
