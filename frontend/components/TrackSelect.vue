<template>
  <b-select
    :expanded="expanded"
    :model-value="selected"
    @update:model-value="(v: string) => $emit('update:modelValue', v)"
  >
    <option v-if="includeFull" value="full">Full track</option>
    <optgroup
      v-for="group in groups"
      :key="group.label"
      :label="`${kindLabel} · ${group.tracks[kind]}`"
    >
      <option v-for="entry in group.models" :key="entry.model" :value="entry.model">
        {{ entry.short }}
      </option>
    </optgroup>
    <optgroup v-if="fileOptions.length > 0" :label="`${kindLabel} · uploaded`">
      <option v-for="option in fileOptions" :key="option.source" :value="option.source">
        {{ option.name }}
      </option>
    </optgroup>
  </b-select>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { BSelect } from "buefy";
import { useMediaStore } from "@/stores/media";
import { TrackSource } from "@/types";
import { SEPARATION_MODEL_GROUPS, SeparationModelGroup } from "@/lib/separationModels";
import { parseFileSource } from "@/lib/trackSources";

// Picks between the full song and the tracks of one kind that separations and uploads left.
// The value is "full" or a track source.
export default defineComponent({
  components: { BSelect },
  props: {
    kind: {
      type: String as PropType<"vocals" | "backing">,
      required: true,
    },
    modelValue: {
      type: String as PropType<"full" | TrackSource | null>,
      default: null,
    },
    includeFull: {
      type: Boolean,
      default: true,
    },
    expanded: Boolean,
  },
  emits: ["update:modelValue"],
  setup() {
    return { mediaStore: useMediaStore() };
  },
  computed: {
    sources(): TrackSource[] {
      return this.kind === "vocals" ? this.mediaStore.vocalSources : this.mediaStore.backingSources;
    },
    kindLabel(): string {
      return this.kind === "vocals" ? "Vocals" : "Backing";
    },
    fileOptions(): { source: TrackSource; name: string }[] {
      return this.sources.flatMap((source) => {
        const file = parseFileSource(source);
        return file ? [{ source, name: file.name }] : [];
      });
    },
    groups(): SeparationModelGroup[] {
      return SEPARATION_MODEL_GROUPS.map((group) => ({
        ...group,
        models: group.models.filter((entry) => this.sources.includes(entry.model)),
      })).filter((group) => group.models.length > 0);
    },
    // A value with no option behind it, such as a track that was discarded, shows the first option.
    selected(): string | undefined {
      const options: string[] = this.includeFull ? ["full", ...this.sources] : this.sources;
      return this.modelValue && options.includes(this.modelValue) ? this.modelValue : options[0];
    },
  },
});
</script>
