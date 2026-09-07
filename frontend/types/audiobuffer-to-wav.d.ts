declare module "audiobuffer-to-wav" {
  export default function audioBufferToWav(
    buffer: AudioBuffer,
    options?: { float32?: boolean }
  ): ArrayBuffer;
}
