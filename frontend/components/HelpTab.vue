<template>
  <b-tab-item value="help" label="Intro" icon="circle-info" class="scroll-wrapper">
    <div class="content" @click="onContentClick">
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
            <strong>Timing:</strong> Play the song and tap <em>start</em> as each syllable in the
            queue reaches the line, and <em>end</em> to mark pauses. If it's too fast, slow the song
            down. Then switch to <em>Adjust</em> and drag the edges of any timing that's off.
          </li>
          <li>
            <strong>Submit:</strong> Pick fonts and colors, check the preview, and click
            <em>Create Video</em>. You get a zip with the video and the files to redo it later.
          </li>
        </ol>
        <p>
          <a :href="EXAMPLE_PROJECT_HREF">Load an example song</a> to try it out with the lyrics and
          timings already done.
        </p>
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
import {
  EXAMPLE_PROJECT_HREF,
  EXAMPLE_PROJECT_NAME,
  fetchExampleProject,
} from "@/lib/exampleProject";
import { useProjectFolderRequestStore } from "@/stores/projectFolderRequest";

export default defineComponent({
  emits: ["show-tab"],
  setup() {
    return {
      custom: customIntro,
      projectFolderRequestStore: useProjectFolderRequestStore(),
      EXAMPLE_PROJECT_HREF,
    };
  },
  data() {
    return { isLoadingExample: false };
  },
  methods: {
    /**
     * Load the example project from its link, which may sit in the custom intro's rendered HTML.
     */
    async onContentClick(event: MouseEvent) {
      const link = (event.target as Element).closest(`a[href="${EXAMPLE_PROJECT_HREF}"]`);
      if (!link) {
        return;
      }
      event.preventDefault();
      if (this.isLoadingExample) {
        return;
      }
      this.isLoadingExample = true;
      try {
        const files = await fetchExampleProject();
        this.$emit("show-tab", "song");
        this.projectFolderRequestStore.request(files, EXAMPLE_PROJECT_NAME);
      } catch (e) {
        console.error(e);
        this.$buefy.toast.open({
          message: `Couldn't load the example song: ${(e as Error).message}`,
          type: "is-danger",
          duration: 5000,
        });
      } finally {
        this.isLoadingExample = false;
      }
    },
  },
});
</script>
