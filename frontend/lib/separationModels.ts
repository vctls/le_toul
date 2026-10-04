import type { SeparationModel } from "@/types";

export const BACKING_VOCALS_SEPARATOR_MODEL = "UVR_MDXNET_KARA_2.onnx";
export const NO_VOCALS_SEPARATOR_MODEL = "UVR-MDX-NET-Inst_HQ_3.onnx";
// Keep backing vocals, higher quality. Much slower than MDX-Net without a GPU.
export const BACKING_VOCALS_HQ_SEPARATOR_MODEL =
  "mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt";
export const BACKING_VOCALS_HQ_ALT_SEPARATOR_MODEL = "mel_band_roformer_karaoke_becruily.ckpt";
// Remove backing vocals, highest reported SDR. Heaviest model.
export const NO_VOCALS_HQ_SEPARATOR_MODEL = "model_bs_roformer_ep_317_sdr_12.9755.ckpt";

export const SEPARATION_MODELS: readonly string[] = [
  BACKING_VOCALS_SEPARATOR_MODEL,
  BACKING_VOCALS_HQ_SEPARATOR_MODEL,
  BACKING_VOCALS_HQ_ALT_SEPARATOR_MODEL,
  NO_VOCALS_SEPARATOR_MODEL,
  NO_VOCALS_HQ_SEPARATOR_MODEL,
];

export interface SeparationModelGroup {
  label: string;
  // What each track the group's models make holds.
  tracks: { vocals: string; backing: string };
  // The short name is what the track dropdowns show and what exported track files start with,
  // so it must stay unique and safe in a file name.
  models: { model: SeparationModel; name: string; short: string; hint: string }[];
}

export const SEPARATION_MODEL_GROUPS: readonly SeparationModelGroup[] = [
  {
    label: "Keep backing vocals",
    tracks: { vocals: "lead only", backing: "with backing vocals" },
    models: [
      {
        model: BACKING_VOCALS_SEPARATOR_MODEL,
        name: "MDX-Net",
        short: "MDX-Kara",
        hint: "fastest",
      },
      {
        model: BACKING_VOCALS_HQ_SEPARATOR_MODEL,
        name: "Mel-Band Roformer (aufr33/viperx)",
        short: "MelBand-Viperx",
        hint: "higher quality · slower",
      },
      {
        model: BACKING_VOCALS_HQ_ALT_SEPARATOR_MODEL,
        name: "Mel-Band Roformer (becruily)",
        short: "MelBand-Becruily",
        hint: "higher quality, newer · slower",
      },
    ],
  },
  {
    label: "Remove backing vocals",
    tracks: { vocals: "with backing vocals", backing: "without backing vocals" },
    models: [
      {
        model: NO_VOCALS_SEPARATOR_MODEL,
        name: "MDX-Net Inst HQ",
        short: "MDX-Inst",
        hint: "fastest",
      },
      {
        model: NO_VOCALS_HQ_SEPARATOR_MODEL,
        name: "BS-Roformer",
        short: "BS-Roformer",
        hint: "highest quality · slowest",
      },
    ],
  },
];

export function separationModelShortName(model: SeparationModel): string {
  for (const group of SEPARATION_MODEL_GROUPS) {
    const entry = group.models.find((candidate) => candidate.model === model);
    if (entry) {
      return entry.short;
    }
  }
  return model;
}
