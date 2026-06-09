<template>
  <div v-if="hasAnyFiles" class="is-size-7 has-text-centered has-text-gray source-file-links">
    <span>Source files: </span>
    <span v-if="lyrics" class="file-item">
      lyrics.txt
      <a @click="download(lyrics, 'lyrics.txt')" title="download lyrics"><b-icon icon="download" /></a><a
        @click="copyToClipboard(lyrics)" title="copy lyrics to clipboard"><b-icon icon="copy" /></a>
    </span>
    <span v-if="hasTimings" class="file-item">
      timings.json
      <a @click="download(timings, 'timings.json')" title="download timings"><b-icon icon="download" /></a><a
        @click="copyToClipboard(timings)" title="copy timings to clipboard"><b-icon icon="copy" /></a>
    </span>
    <span v-if="subtitles" class="file-item">
      subtitles.ass
      <a @click="download(subtitles, 'subtitles.ass')" title="download subtitles"><b-icon icon="download" /></a><a
        @click="copyToClipboard(subtitles)" title="copy subtitles to clipboard"><b-icon icon="copy" /></a>
    </span>
    <span v-if="settings" class="file-item">
      settings.yaml
      <a @click="download(settings, 'settings.yaml')" title="download settings"><b-icon icon="download" /></a><a
        @click="copyToClipboard(settings)" title="copy settings to clipboard"><b-icon icon="copy" /></a>
    </span>
    <span v-if="vocals && vocals.size > 0" class="file-item">
      vocals.wav
      <a @click="download(vocals, 'vocals.wav')" title="download vocals"><b-icon icon="download" /></a>
    </span>
    <span v-if="accompaniment && accompaniment.size > 0" class="file-item">
      accompaniment.wav
      <a @click="download(accompaniment, 'accompaniment.wav')" title="download accompaniment"><b-icon
          icon="download" /></a>
    </span>
  </div>
</template>

<script lang="ts">
import { isString } from "lodash-es";
import Vue, { defineComponent } from "vue";

export default defineComponent({
  props: {
    lyrics: String,
    // Either a single voice's array of [time, marker] tuples, or a per-voice map.
    timings: [Array, Object],
    subtitles: String,
    settings: String,
    vocals: Blob,
    accompaniment: Blob,
  },
  computed: {
    hasTimings(): boolean {
      if (!this.timings) return false;
      return Array.isArray(this.timings)
        ? this.timings.length > 0
        : Object.keys(this.timings).length > 0;
    },
    hasAnyFiles(): boolean {
      return Boolean(
        this.lyrics ||
        this.hasTimings ||
        this.subtitles ||
        this.settings ||
        (this.vocals && this.vocals.size > 0) ||
        (this.accompaniment && this.accompaniment.size > 0)
      );
    },
  },
  methods: {
    download(data, filename) {
      const blob = data instanceof Blob
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
    async copyToClipboard(data) {
      const text = isString(data) ? data : JSON.stringify(data);
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          // navigator.clipboard is only available in secure contexts
          // (HTTPS / localhost). Fall back to the legacy execCommand path
          // so the app stays functional over plain HTTP.
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.setAttribute("readonly", "");
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.select();
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
.source-file-links .file-item+.file-item::before {
  content: "\2022 ";
}
</style>
