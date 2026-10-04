export enum CreationPhase {
  NotStarted,
  SeparatingVocals,
  CreatingVideo,
}

export type SeparationModel =
  | "UVR_MDXNET_KARA_2.onnx"
  | "UVR-MDX-NET-Inst_HQ_3.onnx"
  | "mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt"
  | "mel_band_roformer_karaoke_becruily.ckpt"
  | "model_bs_roformer_ep_317_sdr_12.9755.ckpt";

export type TrackKind = "backing" | "vocals";

// Where a backing and vocal pair came from: a separation model, or one file the user uploaded
// or a folder held outside a model's pair. A file's source names its kind and file name.
export type TrackSource = SeparationModel | `file:${TrackKind}/${string}`;
