<template>
  <div class="is-size-7 has-text-centered has-text-gray">
    <span>Source files: </span>
    lyrics.txt
    <a @click="download(lyrics, 'lyrics.txt')" title="download lyrics"><b-icon icon="download" /></a><a
      @click="copyToClipboard(lyrics)" title="copy lyrics to clipboard"><b-icon icon="copy" /></a>
    &bullet; timings.json
    <a @click="download(timings, 'timings.json')" title="download timings"><b-icon icon="download" /></a><a
      @click="copyToClipboard(timings)" title="copy timings to clipboard"><b-icon icon="copy" /></a>
    &bullet; subtitles.ass
    <a @click="download(subtitles, 'subtitles.ass')" title="download subtitles"><b-icon icon="download" /></a><a
      @click="copyToClipboard(subtitles)" title="copy subtitles to clipboard"><b-icon icon="copy" /></a>
  </div>
</template>

<script lang="ts">
import { isString } from "lodash-es";
import Vue, { defineComponent } from "vue";

export default defineComponent({
  props: {
    lyrics: String,
    timings: Array,
    subtitles: String,
  },
  methods: {
    download(data, filename) {
      const text = isString(data) ? data : JSON.stringify(data);
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
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
