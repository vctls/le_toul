<template>
  <b-tab-item
    value="lyrics"
    label="Lyrics"
    icon="align-left"
    class="lyric-input-tab"
    headerClass="lyric-input-tab-header"
  >
    <h2 class="title">Song Lyrics</h2>
    <help-section>
      <p v-if="provider">
        When you load a song and this box is empty, {{ appName }} tries to fetch the lyrics from
        <a :href="provider.url" target="_blank" rel="noopener">{{ provider.name }}</a
        >.
      </p>
      <div class="columns is-variable is-5">
        <div class="column">
          <p>
            {{
              provider
                ? "If that finds nothing, paste them from the Internet."
                : "Paste 'em from the Internet!"
            }}
            A blank line indicates a new screen. By default, you'll enter the timing of each line.
            Use <kbd>_</kbd> to enter a timing of a word or <kbd>/</kbd> to enter a timing of a
            syllable. Example:
          </p>
          <pre>{{ singleVoiceExample }}</pre>
        </div>
        <div class="column">
          <p>
            If there is more than one voice in your song, prefix the first line of each new voice
            with a tag between square brackets. Example:
          </p>
          <pre>{{ multiVoiceExample }}</pre>
        </div>
      </div>
    </help-section>
    <p v-if="statusMessage" class="lyrics-lookup-status" role="status">
      {{ statusMessage.text }}
      <a v-if="statusMessage.url" :href="statusMessage.url" target="_blank" rel="noopener"
        >See it on {{ provider.name }}</a
      >
    </p>
    <div class="level is-mobile">
      <div class="level-item">
        <b-tooltip position="is-right" label="Convert all spaces to underscores">
          <b-button @click="convertSpaces">Add Underscores</b-button></b-tooltip
        >
      </div>
      <div class="level-item">
        <b-checkbox type="is-primary" v-model="magicSlashes">
          <b-tooltip
            multilined
            label="Adding a slash to a word will add the same slash to all instances of that word"
            position="is-right"
            dashed
            >Magic Slashes</b-tooltip
          ></b-checkbox
        >
      </div>
    </div>
    <song-player :file="songFile" />
    <lyric-editor
      ref="lyricEditor"
      :modelValue="lyricText"
      :magic-slashes="magicSlashes"
      @update:modelValue="onLyricInput"
    ></lyric-editor>
  </b-tab-item>
</template>

<script>
import { defineComponent } from "vue";
import { storeToRefs } from "pinia";
import { useLyricsStore } from "@/stores/lyrics";
import LyricEditor from "@/components/LyricEditor.vue";
import HelpSection from "@/components/HelpSection.vue";
import SongPlayer from "@/components/SongPlayer.vue";
import { useMediaStore } from "@/stores/media";
import { useLyricsLookupStore } from "@/stores/lyricsLookup";
import { formatDuration } from "@/lib/lyricsLookup";
import { appName } from "@/constants";

/**
 * Describes a match as "Artist – Title (Album, 3:52)".
 */
function describeMatch(match) {
  const details = [match.album, match.duration ? formatDuration(match.duration) : null]
    .filter(Boolean)
    .join(", ");
  return `${match.artist} – ${match.title}${details ? ` (${details})` : ""}`;
}

export default defineComponent({
  components: {
    HelpSection,
    LyricEditor,
    SongPlayer,
  },
  setup() {
    const lyricStore = useLyricsStore();
    const { lyricText } = storeToRefs(lyricStore);
    const { songFile } = storeToRefs(useMediaStore());
    const { provider, status } = storeToRefs(useLyricsLookupStore());
    return {
      lyricText,
      songFile,
      provider,
      status,
      appName: appName(),
    };
  },
  data() {
    return {
      magicSlashes: true,
      singleVoiceExample: "Hell/o_from_the_oth/er_side\nI_must_have_called_a_thou/sand_times",
      multiVoiceExample:
        "[Bob]Hell/o_from_the_oth/er_side\n[Alice]I_must_have_called_a_thou/sand_times\n[Alice+Bob]To_tell_you_I'm so/rry_for_e/very/thing_that_I've_done",
    };
  },
  computed: {
    statusMessage() {
      const name = this.provider?.name;
      const status = this.status;
      if (!name || !status) return null;
      switch (status.kind) {
        case "looking":
          return { text: `Looking up lyrics on ${name}…` };
        case "found":
          return {
            text: `Lyrics from ${name}: ${describeMatch(status.match)}. Check them against the song.`,
            url: status.match.url,
          };
        case "instrumental":
          return { text: `${name} lists this song as instrumental.`, url: status.match.url };
        case "notFound":
          return { text: `No lyrics found on ${name}.` };
        default:
          return { text: `Couldn't reach ${name}.` };
      }
    },
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

.lyrics-lookup-status {
  margin-bottom: 0.75rem;
  font-size: 0.875rem;
  opacity: 0.8;
}
</style>
