<template>
  <b-field v-if="voices.length > 1" horizontal label="Voice" class="voice-selector">
    <b-select v-model="activeVoice" aria-label="Active voice">
      <option v-for="voice in voices" :key="voice" :value="voice">{{ voice }}</option>
    </b-select>
  </b-field>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import { storeToRefs } from "pinia";
import { BField, BSelect } from "buefy";
import { useLyricsStore } from "@/stores/lyrics";
import { useTimingsStore } from "@/stores/timings";
import { VoiceId } from "@/lib/voices";

// Global voice selector, shown only when there is more than one voice. Reads the voices
// from the lyrics and reads/writes the shared active voice on the timings store, so all
// tabs that render it stay in sync.
export default defineComponent({
  components: { BField, BSelect },
  setup() {
    const lyricsStore = useLyricsStore();
    const timingsStore = useTimingsStore();
    const { voices } = storeToRefs(lyricsStore);
    return { timingsStore, voices };
  },
  computed: {
    activeVoice: {
      get(): VoiceId {
        return this.timingsStore.activeVoice;
      },
      set(voice: VoiceId) {
        this.timingsStore.setActiveVoice(voice);
      },
    },
  },
});
</script>

<style scoped>
.voice-selector {
  margin-bottom: 0;
  align-items: center;
}
</style>
