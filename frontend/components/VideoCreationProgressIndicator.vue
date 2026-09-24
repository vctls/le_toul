<template>
  <div class="video-creation-progress-indicator">
    <b-message
      :type="messageType"
      has-icon
      :icon="messageIcon"
      icon-size="is-small"
      :closable="false"
    >
      {{ message }}
    </b-message>
    <b-progress
      :type="messageType"
      size="is-medium"
      :rounded="false"
      :value="progressValue"
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
    // Progress of the SeparatingVocals phase, from 0 to 1, or null when the backend reports no figure
    separationProgress: { type: Number as PropType<number | null>, default: null },
    // What the SeparatingVocals phase is doing right now, e.g. "separating the vocals"
    separationStage: { type: String as PropType<string | null>, default: null },
    // Songs the backend separates before this one, or null once it has started
    separationSongsAhead: { type: Number as PropType<number | null>, default: null },
    // Whether the separation was already running when the video was requested
    waitingForSeparation: Boolean,
  },
  data() {
    return {
      CreationPhase,
    };
  },
  computed: {
    isSeparating(): boolean {
      return this.phase == CreationPhase.SeparatingVocals;
    },
    messageType(): string {
      return this.isSeparating ? "is-info" : "is-success";
    },
    messageIcon(): string {
      return this.isSeparating ? "stopwatch" : "wand-magic-sparkles";
    },
    message(): string {
      if (!this.isSeparating) {
        return "Creating your karaoke video. This might take a few minutes.";
      }
      if (this.waitingForSeparation) {
        return "Waiting for the track separation. Your video will start rendering as soon as it finishes.";
      }
      return "Separating the vocals from the music. Your video will start rendering as soon as this is done.";
    },
    progressMessage(): string {
      if (this.isSeparating) {
        const stage = this.separationStage ?? "separating the vocals";
        const label = stage[0].toUpperCase() + stage.slice(1);
        if (this.separationProgress === null && this.estimatedSeparationProgress === null) {
          return `${label}...`;
        }
        return `${label}: ${Math.round(this.phaseProgress * 100)}%`;
      }
      const step = this.step ? this.step[0].toUpperCase() + this.step.slice(1) : "Creating video";
      return `${step}: ${Math.round(this.phaseProgress * 100)}%`;
    },
    // Stand-in for a job that reports no progress of its own:
    // separation takes roughly as long as the song on the hardware this was written for.
    estimatedSeparationProgress(): number | null {
      if (!this.songDuration || this.separationSongsAhead !== null) {
        return null;
      }
      return Math.min((this.elapsedTime ?? 0) / 1000 / this.songDuration, 1);
    },
    phaseProgress(): number {
      if (this.isSeparating) {
        return this.separationProgress ?? this.estimatedSeparationProgress ?? 0;
      }
      if (this.phase == CreationPhase.CreatingVideo) {
        return this.progress ?? 0;
      }
      return 0;
    },
    // undefined leaves the bar indeterminate,
    // for a separation with nothing to report and no song duration to estimate from.
    progressValue(): number | undefined {
      if (
        this.isSeparating &&
        this.separationProgress === null &&
        this.estimatedSeparationProgress === null
      ) {
        return undefined;
      }
      return this.phaseProgress * 100;
    },
  },
});
</script>

<style scoped>
.video-creation-progress-indicator {
  padding: 0.5rem;
}
</style>
