<template>
  <div class="video-creation-progress-indicator">
    <b-message type="is-success" has-icon icon="wand-magic-sparkles" :closable="false">
      Creating your karaoke video. This might take a few minutes.
    </b-message>
    <b-progress
      type="is-success"
      size="is-medium"
      :rounded="false"
      :value="phaseProgress * 100"
      show-value
    >
      {{ progressMessage }}
    </b-progress>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { CreationPhase } from "@/types";

export default defineComponent({
  props: {
    // Progress of CreatingVideo phase, from 0 to 1
    progress: Number,
    // Millis elapsed since submission start
    elapsedTime: Number,
    // Duration of the song in seconds
    songDuration: Number,
    // What the CreatingVideo phase is doing right now, e.g. "encoding the vocals track"
    step: String,
    phase: Number as PropType<CreationPhase>,
  },
  data() {
    return {
      CreationPhase,
    };
  },
  computed: {
    progressMessage() {
      if (this.phase == CreationPhase.CreatingVideo) {
        const step = this.step ? this.step[0].toUpperCase() + this.step.slice(1) : "Creating video";
        return `${step}: ${Math.round(this.phaseProgress * 100)}%`;
      } else if (this.phase == CreationPhase.SeparatingVocals) {
        return `Creating instrumental track: ${Math.round(
          this.phaseProgress * 100
        )}%`;
      }
    },
    phaseProgress(): number {
      if (this.phase == CreationPhase.CreatingVideo) {
        return this.progress ?? 0;
      } else if (this.phase == CreationPhase.SeparatingVocals) {
        const elapsedSeconds = (this.elapsedTime ?? 0) / 1000;
        return Math.min(elapsedSeconds / (this.songDuration || 1), 1);
      }
      return 0;
    },
  },
});
</script>

<style scoped>
.video-creation-progress-indicator {
  padding: 0.5rem;
}
</style>

