<template>
  <div class="create-video-button">
    <b-message
      v-if="submitting && isSeparating"
      type="is-info"
      has-icon
      icon="stopwatch"
      icon-size="is-small"
      :closable="false"
    >
      {{ message }}
    </b-message>
    <button
      type="button"
      class="button is-large is-fullwidth"
      :class="
        submitting
          ? {
              'is-progress': true,
              'is-separating': isSeparating,
              'is-indeterminate': progressValue === undefined,
              'is-cancellable': isCancellable,
            }
          : 'is-primary'
      "
      :style="{ '--progress': `${progressValue ?? 0}%` }"
      :disabled="disabled && !submitting"
      :aria-label="submitting ? `Cancel video creation (${progressMessage})` : undefined"
      @click="onClick"
    >
      <span v-if="submitting" class="labels">
        <span class="progress-label">{{ progressMessage }}</span>
        <span class="cancel-label">Cancel</span>
      </span>
      <template v-else>Create Video</template>
    </button>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { CreationPhase } from "@/types";
import { CANCEL_ARMING_DELAY_MS } from "@/constants";

export default defineComponent({
  props: {
    submitting: Boolean,
    disabled: Boolean,
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
  emits: ["create", "cancel"],
  data() {
    return {
      isCancellable: false,
      armingTimeout: undefined as ReturnType<typeof setTimeout> | undefined,
    };
  },
  watch: {
    submitting: {
      handler(submitting: boolean) {
        clearTimeout(this.armingTimeout);
        this.isCancellable = false;
        if (submitting) {
          this.armingTimeout = setTimeout(() => {
            this.isCancellable = true;
          }, CANCEL_ARMING_DELAY_MS);
        }
      },
      immediate: true,
    },
  },
  beforeUnmount() {
    clearTimeout(this.armingTimeout);
  },
  computed: {
    isSeparating(): boolean {
      return this.phase == CreationPhase.SeparatingVocals;
    },
    message(): string {
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
  methods: {
    onClick() {
      if (!this.submitting) {
        this.$emit("create");
      } else if (this.isCancellable) {
        this.$emit("cancel");
      }
    },
  },
});
</script>

<style scoped>
.button.is-progress {
  --tone-h: var(--bulma-success-h);
  --tone-s: var(--bulma-success-s);
  --tone-l: var(--bulma-success-l);
  position: relative;
  overflow: hidden;
  border-color: hsl(var(--tone-h), var(--tone-s), var(--tone-l));
  background-color: hsla(var(--tone-h), var(--tone-s), var(--tone-l), 0.12);
  color: var(--bulma-text-strong);
}

.button.is-progress.is-separating {
  --tone-h: var(--bulma-info-h);
  --tone-s: var(--bulma-info-s);
  --tone-l: var(--bulma-info-l);
}

.button.is-progress::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--progress);
  background-color: hsla(var(--tone-h), var(--tone-s), var(--tone-l), 0.4);
  transition: width 0.3s ease-out;
}

.button.is-progress.is-indeterminate::before {
  width: 30%;
  transition: none;
  animation: sweep 1.5s ease-in-out infinite;
}

@keyframes sweep {
  from {
    left: -30%;
  }
  to {
    left: 100%;
  }
}

.button.is-progress.is-cancellable:is(:hover, :focus-visible) {
  --tone-h: var(--bulma-danger-h);
  --tone-s: var(--bulma-danger-s);
  --tone-l: var(--bulma-danger-l);
}

/* Both labels share one cell, so the button keeps its size when they swap. */
.labels {
  position: relative;
  display: grid;
  min-width: 0;
}

.labels > span {
  grid-area: 1 / 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cancel-label,
.is-cancellable:is(:hover, :focus-visible) .progress-label {
  visibility: hidden;
}

.is-cancellable:is(:hover, :focus-visible) .cancel-label {
  visibility: visible;
}
</style>
