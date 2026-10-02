import type WaveSurfer from "wavesurfer.js";
import createElement from "wavesurfer.js/dist/dom.js";
import { listenForDrags } from "./dragStream";

// Keep in sync with --bulma-primary in main.scss.
const MARQUEE_COLOR = "#7957d5";

export interface MarqueeArea {
  // The stretch of the song the box spans, in seconds.
  start: number;
  end: number;
  // Whether the drag runs forward in time.
  forward: boolean;
  touches: (element: HTMLElement) => boolean;
}

export interface MarqueeOptions {
  canStart: () => boolean;
  // The box spans every row, as a stretch of time, rather than following the pointer up and down.
  fullHeight?: boolean;
  onChange: (area: MarqueeArea) => void;
}

/**
 * Draw a box as the pointer is dragged from a bare spot on the waveform, and call `onChange` each
 * time it changes. Returns a function that stops listening.
 */
export function listenForMarquee(
  wavesurfer: WaveSurfer,
  { canStart, fullHeight = false, onChange }: MarqueeOptions,
): () => void {
  const wrapper = wavesurfer.getWrapper();
  let marquee: { element: HTMLElement; startX: number; startY: number } | undefined;

  const move = (x: number, y: number) => {
    if (!marquee) return;
    const { element, startX, startY } = marquee;
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    // The box stays in view, so it never selects anything out of sight.
    const viewLeft = wavesurfer.getScroll();
    const viewRight = viewLeft + wavesurfer.getWidth();
    const left = clamp(Math.min(startX, x), viewLeft, viewRight);
    const right = clamp(Math.max(startX, x), viewLeft, viewRight);
    const top = fullHeight ? 0 : clamp(Math.min(startY, y), 0, wrapper.clientHeight);
    const bottom = fullHeight
      ? wrapper.clientHeight
      : clamp(Math.max(startY, y), 0, wrapper.clientHeight);
    Object.assign(element.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${right - left}px`,
      height: `${bottom - top}px`,
    });

    const origin = wrapper.getBoundingClientRect();
    const touches = (target: HTMLElement) => {
      const box = target.getBoundingClientRect();
      return (
        box.right - origin.left > left &&
        box.left - origin.left < right &&
        box.bottom - origin.top > top &&
        box.top - origin.top < bottom
      );
    };
    const seconds = (px: number) => (px / wrapper.clientWidth) * wavesurfer.getDuration();
    onChange({ start: seconds(left), end: seconds(right), forward: x >= startX, touches });
  };

  const end = () => {
    marquee?.element.remove();
    marquee = undefined;
  };

  const stopListening = listenForDrags(
    wrapper,
    {
      onStart: (x, y) => {
        const element = createElement(
          "div",
          {
            part: "selection-marquee",
            style: {
              position: "absolute",
              zIndex: "5",
              boxSizing: "border-box",
              border: `1px solid ${MARQUEE_COLOR}`,
              backgroundColor: `color-mix(in srgb, ${MARQUEE_COLOR} 15%, transparent)`,
              pointerEvents: "none",
            },
          },
          wrapper,
        );
        marquee = { element, startX: x, startY: y };
        move(x, y);
      },
      onMove: (_dx, _dy, x, y) => move(x, y),
      onEnd: end,
    },
    {
      // Only a press on the bare waveform targets the wrapper itself.
      // A finger there scrolls the waveform instead.
      canStart: (event) => event.target === wrapper && event.pointerType !== "touch" && canStart(),
    },
  );

  return () => {
    end();
    stopListening();
  };
}
