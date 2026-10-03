let context: AudioContext | undefined;

/**
 * Update the output latency that `outputLatency` reports. Browsers only start an AudioContext
 * after a user gesture, so call this from one.
 */
export async function refreshOutputLatency(): Promise<void> {
  if (typeof AudioContext === "undefined") return;
  context ??= new AudioContext();
  await context.resume();
  // The latency stays readable once the context is suspended, which closes its idle output stream.
  await context.suspend();
}

/**
 * How long the audio the browser has handed to the system takes to play, in seconds.
 * It is 0 until `refreshOutputLatency` has run, and in browsers that don't report it.
 */
export function outputLatency(): number {
  return context?.outputLatency ?? 0;
}
