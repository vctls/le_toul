<template>
  <audio ref="audioPlayer" v-bind="$attrs" @play="startTimeUpdateLoop($event)" @pause="onPause"
    @seeking="$emit('seeking', $event)" @seeked="$emit('seeked', $event)" @waiting="$emit('waiting', $event)"
    @error="$emit('error', $event)"></audio>
</template>

<script lang="ts">
// A wrapper for an audio element that emits timeupdate events more frequently
import { computed, defineComponent, ref } from "vue";

export default defineComponent({
  inheritAttrs: false,
  emits: ["timeupdate", "seeking", "error", "play", "pause", "seeked", "waiting"],
  setup() {
    const audioPlayer = ref(null);
    return { audioPlayer };
  },
  // Expose currentTime as a property
  mounted() {
    Object.defineProperty(this, 'playbackRate', {
      get: () => this.audioPlayer?.playbackRate || 1,
      set: (value) => {
        if (this.audioPlayer) {
          this.audioPlayer.playbackRate = value;
        }
      }
    });
    Object.defineProperty(this, 'currentTime', {
      get: () => this.audioPlayer?.currentTime || 0,
      set: (value) => {
        if (typeof value !== 'number' || isNaN(value)) {
          console.warn("Invalid value for currentTime:", value);
          return;
        }
        if (this.audioPlayer) {
          this.audioPlayer.currentTime = value;
        }
      }
    });
  },
  data() {
    return {
      animationFrameId: null as number | null,
      lastTime: 0,
    };
  },
  methods: {
    addEventListener(
      eventName: string,
      callback: EventListenerOrEventListenerObject,
      useCapture: boolean = false
    ) {
      const audio = this.$refs.audioPlayer as HTMLAudioElement;
      audio.addEventListener(eventName, callback, useCapture);
    },
    removeEventListener(
      eventName: string,
      callback: EventListenerOrEventListenerObject,
      useCapture: boolean = false
    ) {
      const audio = this.$refs.audioPlayer as HTMLAudioElement;
      audio.removeEventListener(eventName, callback, useCapture);
    },
    startTimeUpdateLoop(event: Event) {
      this.$emit("play", event);
      const updateTime = () => {
        const audio = this.$refs.audioPlayer as HTMLAudioElement;
        const timeUpdateEvent = new Event("timeupdate");
        Object.defineProperty(timeUpdateEvent, "target", { value: audio });

        if (audio.currentTime !== this.lastTime) {
          this.$emit("timeupdate", timeUpdateEvent);
          this.lastTime = audio.currentTime;
        }

        if (audio.paused) {
          this.stopTimeUpdateLoop();
          return;
        }

        this.animationFrameId = requestAnimationFrame(updateTime);
      };

      this.animationFrameId = requestAnimationFrame(updateTime);
    },
    onPause(event: Event) {
      this.stopTimeUpdateLoop();
      this.$emit("pause", event);
    },
    stopTimeUpdateLoop() {
      if (this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
    },
  },
  beforeUnmount() {
    this.stopTimeUpdateLoop();
  },
});
</script>