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

// The override fields holding colors, which serialize to hex strings.
export const VOICE_STYLE_COLOR_FIELDS = ["primary", "secondary", "outline"] as const;

// Voice style overrides serialize colors as hex strings, like the base video options.
// Used both for localStorage persistence and for the exported settings.yaml.
export function serializeVoiceStyle(style: VoiceStyleOverride): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined) continue;
    out[key] = VOICE_STYLE_COLOR_FIELDS.includes(key as any) ? (value as BuefyColor).toString() : value;
  }
  return out;
}

export function deserializeVoiceStyle(stored: Record<string, unknown>): VoiceStyleOverride {
  const style: VoiceStyleOverride = {};
  for (const [key, value] of Object.entries(stored)) {
    if (value === undefined || value === null) continue;
    style[key] = VOICE_STYLE_COLOR_FIELDS.includes(key as any) ? BuefyColor.parse(value as string) : value;
  }
  return style;
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
