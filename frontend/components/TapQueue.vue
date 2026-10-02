<template>
  <!-- It starts at the playhead and is clipped there, so a tapped segment slides out under it. -->
  <div class="tap-queue" aria-hidden="true">
    <TransitionGroup name="queue" tag="div" class="queue-row">
      <span
        v-for="entry in entries"
        :key="entry.key"
        :class="entry.classes"
        @click="entry.index !== undefined && $emit('pick', entry.index)"
        >{{ entry.text }}</span
      >
    </TransitionGroup>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { ReviewFlag } from "@/lib/timedSegments";

export interface QueueItem {
  index: number;
  text: string;
  isHead: boolean;
  // The next segment is the rest of the same word.
  joinsNext: boolean;
  endsLine: boolean;
  // How much of the segment is timed: its start and what closes it, its start alone, or nothing.
  timing: "full" | "start" | "none";
  review?: ReviewFlag;
}

export default defineComponent({
  emits: ["pick"],
  props: {
    items: { type: Array as PropType<QueueItem[]>, default: () => [] },
  },
  computed: {
    // A transition group needs every element keyed, so line breaks are entries of their own.
    entries(): {
      key: string;
      text: string;
      classes: Record<string, boolean>;
      index?: number;
    }[] {
      return this.items.flatMap((item, i) => {
        const segment = {
          key: `segment-${item.index}`,
          index: item.index,
          text: item.text,
          classes: {
            "queue-item": true,
            "is-head": item.isHead,
            "is-timed": item.timing === "full",
            "is-start-timed": item.timing === "start",
            "joins-next": item.joinsNext,
            "joins-previous": !!this.items[i - 1]?.joinsNext,
            "is-review-lost": item.review === "lost",
            "is-review-moved": item.review === "moved",
          },
        };
        if (!item.endsLine) return [segment];
        return [
          segment,
          { key: `break-${item.index}`, text: "", classes: { "queue-break": true } },
        ];
      });
    },
  },
});
</script>

<style scoped>
.tap-queue {
  --queue-timed: color-mix(in srgb, var(--bulma-primary) 30%, var(--bulma-scheme-main));
  position: absolute;
  top: 50%;
  left: 50%;
  right: 0;
  transform: translateY(-50%);
  overflow: hidden;
  /* Only the segments take clicks. A click anywhere else reaches the waveform under the row. */
  pointer-events: none;
  z-index: 5;
  /* Room for the shadows, which the clipping would otherwise cut off. */
  padding-block: 0.5rem;
}

.queue-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  white-space: nowrap;
}

.queue-item {
  padding: 0.15em 0.45em;
  border: 1px solid var(--bulma-border);
  border-radius: var(--bulma-radius);
  background: var(--bulma-scheme-main);
  color: var(--bulma-text-strong);
  box-shadow: 0 0.1rem 0.4rem rgb(0 0 0 / 35%);
  font-size: 1.25rem;
  line-height: 1.3;
  pointer-events: auto;
  cursor: pointer;
}

.queue-item:hover {
  border-color: var(--bulma-primary);
}

/* A segment sliding out has already been tapped, so it can't be picked any more. */
.queue-leave-active {
  pointer-events: none;
}

.queue-item.is-timed {
  background: var(--queue-timed);
}

/* A start with nothing to close it is half done, so it gets half the tint, as a checkerboard. */
.queue-item.is-start-timed {
  background-image: repeating-conic-gradient(
    var(--queue-timed) 0 25%,
    var(--bulma-scheme-main) 0 50%
  );
  background-size: 4px 4px;
}

.queue-item.is-head {
  border-color: var(--bulma-primary);
  background: var(--bulma-primary);
  color: var(--bulma-primary-invert);
}

/* A segment to review takes its rectangle's colour from the waveform, muted until it is the head.
The muted colour stands in for the timed tint, so a start alone still shows as a checkerboard. */
.queue-item.is-review-lost {
  --review-color: var(--region-review-lost);
}

.queue-item.is-review-moved {
  --review-color: var(--region-review-moved);
}

.queue-item.is-review-lost,
.queue-item.is-review-moved {
  --queue-timed: color-mix(in srgb, var(--review-color) 45%, var(--bulma-scheme-main));
  background-color: var(--queue-timed);
}

.queue-item.is-head.is-review-lost,
.queue-item.is-head.is-review-moved {
  border-color: var(--review-color);
  background: var(--review-color);
  color: var(--region-label-on-fill);
}

/* The syllables of one word touch, so the word reads as one block cut into pieces.
The gap is the row's, so it is taken back. */
.queue-item.joins-next {
  margin-right: calc(1px - 0.5rem);
  border-start-end-radius: 0;
  border-end-end-radius: 0;
}

.queue-item.joins-previous {
  border-start-start-radius: 0;
  border-end-start-radius: 0;
}

.queue-break {
  align-self: stretch;
  width: 3px;
  margin-inline: 0.35rem;
  border-radius: 2px;
  background: var(--bulma-border);
}

.queue-move,
.queue-enter-active,
.queue-leave-active {
  transition:
    transform 120ms ease-out,
    opacity 120ms ease-out;
}

/* The leaving segment is taken out of the row, so the rest can move up at once. */
.queue-leave-active {
  position: absolute;
  left: 0;
}

.queue-leave-to,
.queue-enter-from {
  transform: translateX(-100%);
  opacity: 0;
}
</style>
