<template>
  <b-modal
    :model-value="modelValue"
    @update:model-value="onToggle"
    has-modal-card
    trap-focus
    :can-cancel="isSyncing ? false : ['escape', 'x', 'outside']"
    ariaRole="dialog"
    ariaModal
    ariaLabel="Sync automatically"
  >
    <div class="modal-card auto-sync-dialog">
      <header class="modal-card-head">
        <p class="modal-card-title">Sync automatically</p>
        <button v-if="!isSyncing" type="button" class="delete" aria-label="Close" @click="close" />
      </header>
      <section class="modal-card-body">
        <p class="mb-3">
          Syncing listens to the vocals and times the syllables for you. Check the result
          afterwards: the syllables it wasn't sure of are drawn in yellow, and an undo takes back
          the whole sync.
        </p>
        <p class="mb-4">
          The lyrics should hold every word that is sung, once for each time it's sung, and nothing
          else. A word written but not sung pushes the lines around it out of place.
        </p>
        <b-message v-if="!vocals" type="is-warning" class="is-small">
          No vocals track is loaded, so syncing listens to the whole song, which is less accurate.
          Separate the track in the Song Info tab for a better result.
        </b-message>
        <b-message v-if="hasSeveralVoices" type="is-warning" class="is-small">
          These lyrics have more than one voice, and syncing hears all of them at once. It often
          places a voice on another singer's lines, especially one with a small part, and doesn't
          mark those syllables in yellow. Check every line afterwards.
        </b-message>
        <b-field v-if="modes.length > 1" label="What to sync">
          <div class="mode-choices">
            <b-radio
              v-if="modes.includes('fill')"
              v-model="mode"
              native-value="fill"
              :disabled="isSyncing"
            >
              {{ fillLabel }}
            </b-radio>
            <b-radio
              v-if="modes.includes('selected')"
              v-model="mode"
              native-value="selected"
              :disabled="isSyncing"
            >
              {{ selectedLabel }}
            </b-radio>
            <b-radio v-model="mode" native-value="replace" :disabled="isSyncing">
              Every syllable, replacing the timings already there
            </b-radio>
          </div>
        </b-field>
        <p v-else-if="untimedCount === 0" class="mb-4">
          Every syllable already has a timing, so syncing replaces them all.
        </p>
        <b-field
          label="Lead, in seconds"
          message="How long before the voice each syllable starts. At 0, it starts with the voice."
        >
          <b-numberinput
            :model-value="lead"
            :min="0"
            :max="maxLead"
            :step="0.01"
            :disabled="isSyncing"
            controls-position="compact"
            @update:model-value="(v: number | null | undefined) => (lead = Number(v ?? lead))"
          />
        </b-field>
        <b-progress
          v-if="isSyncing"
          type="is-primary"
          size="is-medium"
          :rounded="false"
          :value="progressPercent"
          show-value
        >
          {{ progressMessage }}
        </b-progress>
        <b-message v-if="notice" type="is-warning" class="is-small">{{ notice }}</b-message>
        <b-message v-if="error" type="is-danger" class="is-small">{{ error }}</b-message>
      </section>
      <footer class="modal-card-foot">
        <div class="buttons is-right is-flex-grow-1">
          <b-button v-if="isSyncing" label="Cancel" type="is-danger is-light" @click="cancel" />
          <template v-else>
            <b-button label="Close" @click="close" />
            <b-button
              label="Sync"
              type="is-primary"
              icon-left="wand-magic-sparkles"
              :disabled="!audio"
              @click="sync"
            />
          </template>
        </div>
      </footer>
    </div>
  </b-modal>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { BButton, BField, BMessage, BModal, BNumberinput, BProgress, BRadio } from "buefy";
import { useMediaStore } from "@/stores/media";
import { useLyricsStore } from "@/stores/lyrics";
import { useTimingsStore } from "@/stores/timings";
import {
  MAX_SYNC_LEAD,
  SyncMode,
  lineNumbers,
  pendingSync,
  selectedLines,
  storeSyncLead,
  storedSyncLead,
  syncVoice,
  unplacedCount,
} from "@/lib/alignment";
import { extensionForBlob } from "@/lib/audio";
import { TimedSegment, fromLyric } from "@/lib/timedSegments";
import { VoiceId } from "@/lib/voices";

export default defineComponent({
  components: { BButton, BField, BMessage, BModal, BNumberinput, BProgress, BRadio },
  props: {
    modelValue: { type: Boolean, default: false },
    voice: { type: String as PropType<VoiceId>, required: true },
    // The indices of the segments selected in Adjust mode.
    selection: { type: Array as PropType<number[]>, default: () => [] },
    // The vocals stem to sync, or null to sync the full song.
    vocals: { type: Blob as PropType<Blob | null>, default: null },
  },
  emits: ["update:modelValue", "synced"],
  setup() {
    return {
      mediaStore: useMediaStore(),
      lyricsStore: useLyricsStore(),
      timingsStore: useTimingsStore(),
    };
  },
  data() {
    return {
      mode: "fill" as SyncMode,
      lead: storedSyncLead(),
      maxLead: MAX_SYNC_LEAD,
      isSyncing: false,
      progress: null as number | null,
      stage: null as string | null,
      error: null as string | null,
      notice: null as string | null,
      controller: null as AbortController | null,
    };
  },
  computed: {
    // A voice that was never timed has no segments in the store yet, so they come from its lyrics.
    segments(): TimedSegment[] {
      const stored = this.timingsStore.segmentsByVoice[this.voice];
      if (stored?.length) return stored;
      return this.lyricsStore.segmentsForVoice(this.voice).map(fromLyric);
    },
    timedCount(): number {
      return this.segments.filter((segment) => segment.start !== undefined).length;
    },
    untimedCount(): number {
      return this.segments.length - this.timedCount;
    },
    fillLabel(): string {
      const count = this.untimedCount;
      return `Only the lines around the ${count} syllable${count === 1 ? "" : "s"} without a timing`;
    },
    selectedLineCount(): number {
      const lines = lineNumbers(this.segments);
      const selected = selectedLines(this.segments, this.selection);
      return new Set(lines.filter((_, i) => selected[i])).size;
    },
    selectedLabel(): string {
      const count = this.selectedLineCount;
      return count === 1
        ? "Only the selected line, replacing its timings"
        : `Only the ${count} selected lines, replacing their timings`;
    },
    // The modes worth offering, of which "replace" is always one.
    modes(): SyncMode[] {
      const lineCount = new Set(lineNumbers(this.segments)).size;
      return [
        ...(this.timedCount > 0 && this.untimedCount > 0 ? ["fill" as const] : []),
        ...(this.selectedLineCount > 0 && this.selectedLineCount < lineCount
          ? ["selected" as const]
          : []),
        "replace",
      ];
    },
    hasSeveralVoices(): boolean {
      return this.lyricsStore.voices.length > 1;
    },
    audio(): Blob | null {
      return this.vocals ?? this.mediaStore.songFile;
    },
    progressPercent(): number | undefined {
      // undefined leaves the bar indeterminate rather than parked at zero.
      return this.progress === null ? undefined : this.progress * 100;
    },
    progressMessage(): string {
      const stage = this.stage ?? "starting";
      const capitalized = stage[0].toUpperCase() + stage.slice(1);
      return this.progress === null
        ? `${capitalized}...`
        : `${capitalized}: ${Math.round(this.progress * 100)}%`;
    },
  },
  watch: {
    lead(lead: number) {
      storeSyncLead(lead);
    },
    modelValue(isOpen: boolean) {
      if (!isOpen) return;
      this.error = null;
      this.notice = null;
      this.mode = this.modes[0];
    },
  },
  beforeUnmount() {
    this.cancel();
  },
  methods: {
    async sync() {
      const audio = this.audio;
      if (!audio) return;
      const name = this.vocals
        ? `vocals.${extensionForBlob(this.vocals)}`
        : (this.mediaStore.songFile?.name ?? "song");
      const mode = this.modes.includes(this.mode) ? this.mode : "replace";
      const pending = pendingSync(this.segments, mode, this.selection);
      const controller = new AbortController();
      this.controller = controller;
      this.isSyncing = true;
      this.error = null;
      this.notice = null;
      this.progress = null;
      this.stage = null;
      try {
        const result = await syncVoice(
          audio,
          name,
          pending.request,
          Math.min(Math.max(this.lead, 0), MAX_SYNC_LEAD),
          ({ progress, stage }) => {
            this.progress = progress;
            this.stage = stage;
          },
          controller.signal,
        );
        const asked = pending.request.filter(({ sync }) => sync).length;
        const unplaced = unplacedCount(pending, result);
        if (unplaced === asked) {
          this.error =
            "Syncing couldn't place any of the syllables, so nothing changed." +
            (mode === "fill" ? " Syncing every syllable may place them." : "");
          return;
        }
        if (!this.timingsStore.applySegmentTimes(this.voice, pending, result)) {
          this.error =
            "This voice's lyrics or timings changed while syncing, so the result was left out. " +
            "Sync again to use it.";
          return;
        }
        this.$emit("synced");
        if (unplaced > 0) {
          this.notice =
            `Syncing couldn't place ${unplaced} of the ${asked} syllables, ` +
            "so they were left without a timing.";
          return;
        }
        this.close();
      } catch (error) {
        if (!controller.signal.aborted) {
          this.error = error instanceof Error ? error.message : String(error);
        }
      } finally {
        this.isSyncing = false;
        this.controller = null;
      }
    },
    cancel() {
      this.controller?.abort();
    },
    close() {
      this.$emit("update:modelValue", false);
    },
    onToggle(isOpen: boolean) {
      if (!isOpen) this.cancel();
      this.$emit("update:modelValue", isOpen);
    },
  },
});
</script>

<style scoped>
.mode-choices {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>
