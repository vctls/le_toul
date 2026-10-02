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
