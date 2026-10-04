<template>
  <div v-if="hasAnyFiles" class="is-size-7 has-text-centered has-text-gray source-file-links">
    <span>{{ label }}</span>
    <span v-if="song" class="file-item">
      {{ song.name }}
      <button
        type="button"
        class="link-button"
        @click="download(song, song.name)"
        title="download song"
      >
        <b-icon icon="download" />
      </button>
    </span>
    <span v-if="lyrics" class="file-item">
      lyrics.txt
      <button
        type="button"
        class="link-button"
        @click="download(lyrics, 'lyrics.txt')"
        title="download lyrics"
      >
        <b-icon icon="download" /></button
      ><button
        type="button"
        class="link-button"
        @click="copyToClipboard(lyrics)"
        title="copy lyrics to clipboard"
      >
        <b-icon icon="copy" />
      </button>
    </span>
    <span v-if="timings" class="file-item">
      timings.txt
      <button
        type="button"
        class="link-button"
        @click="download(timings, 'timings.txt')"
        title="download timings"
      >
        <b-icon icon="download" /></button
      ><button
        type="button"
        class="link-button"
        @click="copyToClipboard(timings)"
        title="copy timings to clipboard"
      >
        <b-icon icon="copy" />
      </button>
    </span>
    <span v-if="subtitles" class="file-item">
      subtitles.ass
      <button
        type="button"
        class="link-button"
        @click="download(subtitles, 'subtitles.ass')"
        title="download subtitles"
      >
        <b-icon icon="download" /></button
      ><button
        type="button"
        class="link-button"
        @click="copyToClipboard(subtitles)"
        title="copy subtitles to clipboard"
      >
        <b-icon icon="copy" />
      </button>
    </span>
    <span v-if="settings" class="file-item">
      settings.yaml
      <button
        type="button"
        class="link-button"
        @click="download(settings, 'settings.yaml')"
        title="download settings"
      >
        <b-icon icon="download" /></button
      ><button
        type="button"
        class="link-button"
        @click="copyToClipboard(settings)"
        title="copy settings to clipboard"
      >
        <b-icon icon="copy" />
      </button>
    </span>
    <span v-for="(file, index) in allFonts" :key="index" class="file-item">
      {{ file.name }}
      <button
        type="button"
        class="link-button"
        @click="download(file, file.name)"
        title="download font"
      >
        <b-icon icon="download" />
      </button>
    </span>
    <span v-for="track in trackFiles" :key="track.name" class="file-item">
      {{ track.name }}
      <button
        type="button"
        class="link-button"
        @click="download(track.blob, track.name)"
        :title="track.kind === 'vocals' ? 'download vocals' : 'download backing track'"
      >
        <b-icon icon="download" />
      </button>
    </span>
  </div>
</template>

<script lang="ts">
import { isString } from "lodash-es";
import { defineComponent, PropType } from "vue";
import { trackEntries } from "@/lib/projectFolder";
import type { TrackKind } from "@/types";
import type { TrackPair } from "@/stores/media";

export default defineComponent({
  props: {
    // The trailing space is load-bearing: template whitespace before the first file is stripped at compile time.
    label: { type: String, default: "Source files: " },
    song: File,
    lyrics: String,
    timings: String,
    subtitles: String,
    settings: String,
    font: File,
    // More fonts, such as the ones uploaded for single voices.
    fonts: { type: Array as PropType<File[]>, default: () => [] },
    tracks: { type: Array as PropType<TrackPair[]>, default: () => [] },
  },
  computed: {
    allFonts(): File[] {
      return this.font ? [this.font, ...this.fonts] : this.fonts;
    },
    trackFiles(): { name: string; kind: TrackKind; blob: Blob }[] {
      return trackEntries(this.tracks);
    },
    hasAnyFiles(): boolean {
      return Boolean(
        this.song ||
        this.lyrics ||
        this.timings ||
        this.subtitles ||
        this.settings ||
        this.allFonts.length > 0 ||
        this.trackFiles.length > 0,
      );
    },
  },
  methods: {
    download(data: unknown, filename: string) {
      const blob =
        data instanceof Blob
          ? data
          : new Blob([isString(data) ? data : JSON.stringify(data)], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    async copyToClipboard(data: unknown) {
      const text = isString(data) ? data : JSON.stringify(data);
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          // navigator.clipboard is only available in secure contexts (HTTPS / localhost).
          // Fall back to the legacy execCommand path so the app stays functional over plain HTTP.
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.setAttribute("readonly", "");
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
          // noinspection JSDeprecatedSymbols
          const ok = document.execCommand("copy");
          textarea.remove();
          if (!ok) throw new Error("execCommand copy returned false");
        }
        this.$buefy.toast.open({
          message: "Copied!",
          type: "is-success",
        });
      } catch (e) {
        console.error(e);
        this.$buefy.toast.open({
          message: "Something went wrong while copying to clipboard!",
          type: "is-danger",
        });
      }
    },
  },
});
</script>

<style scoped>
.source-file-links .file-item + .file-item::before {
  content: "\2022 ";
}
</style>
