<template>
  <div class="voice-style">
    <b-field horizontal :label="voice">
      <b-switch v-model="customizing">Custom style</b-switch>
    </b-field>
    <style-override-fields
      v-if="customizing"
      class="voice-style-fields"
      :override="override"
      :base="base"
      :fonts="fonts"
      :name="voice"
      @set="(field, value) => settingsStore.setVoiceStyleField(voice, field, value)"
    >
      <template #font>
        <b-field horizontal label="Custom Font">
          <file-upload
            expanded
            class="voice-font-upload"
            :accept="['.ttf', '.otf', '.ttc']"
            :model-value="customFont?.file ?? null"
            @update:model-value="onCustomFontChange"
          />
        </b-field>
        <b-field horizontal v-if="customFont">
          <p class="help voice-font-help">
            Rendering {{ voice }} in &ldquo;{{ customFont.family }}&rdquo;, overriding the font
            above.
          </p>
        </b-field>
      </template>
    </style-override-fields>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { BField, BSwitch } from "buefy";
import FileUpload from "@/components/FileUpload.vue";
import StyleOverrideFields from "@/components/StyleOverrideFields.vue";
import { useSettingsStore } from "@/stores/settings";
import { VoiceStyleOverride, isEmptyOverride } from "@/lib/voiceStyle";
import { VoiceId } from "@/lib/voices";

// Editor for a single voice's style override.
export default defineComponent({
  components: { BField, BSwitch, FileUpload, StyleOverrideFields },
  props: {
    voice: { type: String as PropType<VoiceId>, required: true },
    fonts: { type: Object as PropType<Record<string, string>>, required: true },
  },
  setup() {
    return { settingsStore: useSettingsStore() };
  },
  data() {
    return {
      // Expanded when the voice already has an override, toggled by the switch otherwise.
      expanded: !isEmptyOverride(useSettingsStore().getVoiceStyle(this.voice)),
    };
  },
  computed: {
    customFont() {
      return this.settingsStore.getVoiceFont(this.voice);
    },
    override(): VoiceStyleOverride {
      return this.settingsStore.getVoiceStyle(this.voice) ?? {};
    },
    base() {
      return this.settingsStore.videoOptions;
    },
    customizing: {
      // A saved font loads after the row mounts, so it can't only count towards the initial state.
      get(): boolean {
        return this.expanded || this.customFont !== undefined;
      },
      set(on: boolean) {
        this.expanded = on;
        if (!on) {
          this.settingsStore.clearVoiceStyle(this.voice);
        }
      },
    },
  },
  methods: {
    async onCustomFontChange(file: File | null) {
      try {
        await this.settingsStore.setVoiceFont(this.voice, file);
        if (file) {
          this.$buefy.toast.open({
            message: `Using "${this.customFont?.family}" for ${this.voice}.`,
            type: "is-success",
            duration: 2000,
          });
        }
      } catch (e) {
        console.error(e);
        this.$buefy.toast.open({
          message: (e as Error).message,
          type: "is-danger",
          duration: 5000,
        });
      }
    },
  },
});
</script>

<style scoped>
.voice-style {
  border-top: 1px solid #ededed;
  padding-top: 0.5rem;
  margin-top: 0.5rem;
}

.voice-style-fields {
  margin-left: 1rem;
}
</style>
