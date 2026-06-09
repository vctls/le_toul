<template>
  <b-tab-item label="Lyrics" icon="align-left" class="lyric-input-tab" headerClass="lyric-input-tab-header">
    <h2 class="title">Song Lyrics</h2>
    <div class="content">
      <p>
        Paste 'em from the Internet! A blank line indicates a new screen. By
        default, you'll enter the timing of each line. Use <kbd>_</kbd> to enter
        a timing of a word or <kbd>/</kbd> to enter a timing of a syllable.
        Example:
      </p>
        <pre>{{ singleVoiceExample }}</pre>
      <p>
        If there are more than one voice in your song, prefix the first line of each new voice with a tag between
        square brackets. Example:
      </p>
        <pre>{{ multiVoiceExample }}</pre>
    </div>
    <div class="level is-mobile">
      <div class="level-item">
        <b-tooltip position="is-right" label="Convert all spaces to underscores">
          <b-button @click="convertSpaces">Add Underscores</b-button></b-tooltip>
      </div>
      <div class="level-item">
        <b-checkbox type="is-primary" v-model="magicSlashes">
          <b-tooltip multilined label="Adding a slash to a word will add the same slash to all instances of that word"
            position="is-right" dashed>Magic Slashes</b-tooltip></b-checkbox>
      </div>
    </div>
    <lyric-editor ref="lyricEditor" :modelValue="lyricText" :magic-slashes="magicSlashes"
      @update:modelValue="onLyricInput"></lyric-editor>
  </b-tab-item>
</template>

<script>
import { defineComponent } from "vue";
import { storeToRefs } from "pinia";
import { useLyricsStore } from "@/stores/lyrics";
import LyricEditor from "@/components/LyricEditor.vue";

export default defineComponent({
  components: {
    LyricEditor,
  },
  setup() {
    const lyricStore = useLyricsStore();
    const { lyricText } = storeToRefs(lyricStore);
    return {
      lyricText,
    };
  },
  data() {
    return {
      magicSlashes: true,
      singleVoiceExample:
        "Hell/o_from_the_oth/er_side\nI_must_have_called_a_thou/sand_times",
      multiVoiceExample:
        "[Bob]Hell/o_from_the_oth/er_side\n[Alice]I_must_have_called_a_thou/sand_times\n[Alice+Bob]To_tell_you_I'm so/rry_for_e/very/thing_that_I've_done",
    };
  },
  methods: {
    onLyricInput(newValue) {
      this.lyricText = newValue;
    },
    convertSpaces(e) {
      this.$refs.lyricEditor.convertSpaces();
    },
  },
});
</script>

<style scoped>
.lyric-input-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
}
</style>