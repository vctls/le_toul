<template>
  <div class="voice-style">
    <b-field horizontal :label="voice">
      <b-switch v-model="customizing">Custom style</b-switch>
    </b-field>
    <div v-if="customizing" class="voice-style-fields">
      <b-field horizontal label="Font">
        <b-select v-model="fontName">
          <option v-for="(path, name) in fonts" :key="path" :value="name">{{ name }}</option>
        </b-select>
      </b-field>
      <b-field horizontal label="Font Size">
        <b-numberinput v-model="fontSize" controls-position="compact" />
      </b-field>
      <b-field horizontal label="Bold">
        <b-switch v-model="bold" />
      </b-field>
      <b-field horizontal label="Italic">
        <b-switch v-model="italic" />
      </b-field>
      <b-field horizontal label="Primary Color">
        <b-colorpicker v-model="primary" />
      </b-field>
      <b-field horizontal label="Secondary Color">
        <b-colorpicker v-model="secondary" />
      </b-field>
      <b-field horizontal label="Outline Color">
        <b-colorpicker v-model="outline" />
      </b-field>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from "vue";
import { BField, BSelect, BNumberinput, BSwitch, BColorpicker } from "buefy";
import { default as BuefyColor } from "buefy/src/utils/color";
import { useSettingsStore } from "@/stores/settings";
import { VoiceStyleOverride, isEmptyOverride } from "@/lib/voiceStyle";
import { VoiceId } from "@/lib/voices";

// Editor for a single voice's style override. Uses v-model throughout (Vue 3 component
// model binding), mirroring the base "Fonts and Colors" controls.
export default defineComponent({
  components: { BField, BSelect, BNumberinput, BSwitch, BColorpicker },
  props: {
    voice: { type: String as PropType<VoiceId>, required: true },
    fonts: { type: Object as PropType<Record<string, string>>, required: true },
  },
  setup() {
    return { settingsStore: useSettingsStore() };
  },
  data() {
    return {
      // Expanded when the voice already has an override; toggled by the switch otherwise.
      expanded: !isEmptyOverride(useSettingsStore().getVoiceStyle(this.voice)),
    };
  },
  computed: {
    override(): VoiceStyleOverride {
      return this.settingsStore.getVoiceStyle(this.voice) ?? {};
    },
    base() {
      return this.settingsStore.videoOptions;
    },
    customizing: {
      get(): boolean {
        return this.expanded;
      },
      set(on: boolean) {
        this.expanded = on;
        if (!on) {
          this.settingsStore.clearVoiceStyle(this.voice);
        }
      },
    },
    fontName: {
      get(): string {
        return this.override.fontName ?? this.base.font.name;
      },
      set(value: string) {
        this.settingsStore.setVoiceStyleField(this.voice, "fontName", value);
      },
    },
    fontSize: {
      get(): number {
        return this.override.fontSize ?? this.base.font.size;
      },
      set(value: number) {
        this.settingsStore.setVoiceStyleField(this.voice, "fontSize", value);
      },
    },
    bold: {
      get(): boolean {
        return this.override.bold ?? this.base.font.bold ?? true;
      },
      set(value: boolean) {
        this.settingsStore.setVoiceStyleField(this.voice, "bold", value);
      },
    },
    italic: {
      get(): boolean {
        return this.override.italic ?? this.base.font.italic ?? false;
      },
      set(value: boolean) {
        this.settingsStore.setVoiceStyleField(this.voice, "italic", value);
      },
    },
    primary: {
      get(): BuefyColor {
        return this.override.primary ?? this.base.color.primary;
      },
      set(value: BuefyColor) {
        this.settingsStore.setVoiceStyleField(this.voice, "primary", value);
      },
    },
    secondary: {
      get(): BuefyColor {
        return this.override.secondary ?? this.base.color.secondary;
      },
      set(value: BuefyColor) {
        this.settingsStore.setVoiceStyleField(this.voice, "secondary", value);
      },
    },
    outline: {
      get(): BuefyColor {
        return this.override.outline ?? this.base.color.background;
      },
      set(value: BuefyColor) {
        this.settingsStore.setVoiceStyleField(this.voice, "outline", value);
      },
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
