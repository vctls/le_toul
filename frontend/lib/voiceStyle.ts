// Per-voice style overrides.
//
// Each voice can override a limited subset of the base karaoke style. An override is a
// partial set of fields; resolving merges it field-by-field over the base `KaraokeOptions`,
// leaving everything else (count-ins, alignment, etc.) shared. See docs/multi-voice-spec.md.

import { default as BuefyColor } from "buefy/src/utils/color";
import { KaraokeOptions } from "./timing";

export interface VoiceStyleOverride {
  fontName?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  primary?: BuefyColor;
  secondary?: BuefyColor;
  outline?: BuefyColor; // maps to the background/outline color
}

export function isEmptyOverride(override?: VoiceStyleOverride): boolean {
  return !override || Object.values(override).every((v) => v === undefined);
}

// Resolve a voice's effective options by merging its override over the base. Returns the
// base unchanged when there is no override, so un-styled voices render identically.
export function applyVoiceStyle(base: KaraokeOptions, override?: VoiceStyleOverride): KaraokeOptions {
  if (isEmptyOverride(override)) {
    return base;
  }
  const o = override as VoiceStyleOverride;
  return {
    ...base,
    font: {
      ...base.font,
      name: o.fontName ?? base.font.name,
      size: o.fontSize ?? base.font.size,
      bold: o.bold ?? base.font.bold,
      italic: o.italic ?? base.font.italic,
    },
    color: {
      background: o.outline ?? base.color.background,
      primary: o.primary ?? base.color.primary,
      secondary: o.secondary ?? base.color.secondary,
    },
  };
}
