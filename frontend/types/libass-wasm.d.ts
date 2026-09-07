// libass-wasm ships no type declarations. Only the surface this app uses is
// described here; the constructor accepts more options than are listed.
declare module "libass-wasm" {
  export interface SubtitlesOctopusOptions {
    canvas: HTMLCanvasElement;
    subContent: string;
    workerUrl: string;
    legacyWorkerUrl?: string;
    availableFonts?: Record<string, string>;
    lazyFileLoading?: boolean;
    debug?: boolean;
  }

  export default class SubtitlesOctopus {
    constructor(options: SubtitlesOctopusOptions);
    setTrack(content: string): void;
    setCurrentTime(time: number): void;
    setIsPaused(isPaused: boolean, currentTime?: number | null): void;
    dispose?(): void;
  }
}
