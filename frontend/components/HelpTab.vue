<template>
  <b-tab-item value="help" label="Intro" icon="circle-info" class="scroll-wrapper">
    <div class="content">
      <div v-if="custom" v-html="custom.before"></div>
      <template v-if="!custom || custom.showBuiltIn">
        <p>Make a karaoke video from any song, right in your browser.</p>
        <ol>
          <li>
            <strong>Files:</strong> Load a song, and click <em>Separate Track</em> to strip out the
            vocals. While this runs in the background, move on to the lyrics.
          </li>
          <li>
            <strong>Lyrics:</strong> Paste the lyrics and format them so they display nicely for
            karaoke. Listen through once to check them. Changing lyrics later means timing them
            again.
          </li>
          <li>
            <strong>Timing:</strong> Play the song and tap <em>start</em> as each highlighted word
            begins, and <em>end</em> to mark pauses. If it's too fast, slow the song down. Don't
            worry if you can't get everything perfectly, you can adjust timings in the next step.
          </li>
          <li>
            <strong>Adjust:</strong> Play it back and drag the edges of any timing that's off.
          </li>
          <li>
            <strong>Submit:</strong> Pick fonts and colors, check the preview, and click
            <em>Create Video</em>. You get a zip with the video and the files to redo it later.
          </li>
        </ol>
        <p>
          Click <b-icon icon="circle-question" size="is-small" /> at the top for help on each tab.
        </p>
      </template>
      <div v-if="custom" v-html="custom.after"></div>
    </div>
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import customIntro from "virtual:custom-intro";

export default defineComponent({
  setup() {
    return { custom: customIntro };
  },
});
</script>
