import type { LogEvent } from "@ffmpeg/ffmpeg";

// Long enough for the 30-odd MB core to download on a slow connection.
export const STALL_MS = 90_000;
const CHECK_INTERVAL_MS = 10_000;

type LogLevel = "info" | "warning";

interface StageMark {
  stage: string;
  atMs: number;
}

/**
 * The browser capabilities an in-browser render depends on.
 */
export function renderEnvironment() {
  // Neither is standard. Chrome has both, and deviceMemory is rounded down to a power of two.
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string };
  };
  return {
    userAgent: nav.userAgent,
    crossOriginIsolated: window.crossOriginIsolated ?? null,
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    cores: nav.hardwareConcurrency,
    memoryGb: nav.deviceMemory ?? null,
    connection: nav.connection?.effectiveType ?? null,
    origin: window.location.origin,
  };
}

// A hang never throws, so nothing reaches the error log unless a stall is reported on its own.
export class RenderDiagnostics {
  private readonly assetUrls: string[];
  private readonly startedAt = performance.now();
  private readonly stages: StageMark[] = [];
  private readonly stalledStages = new Set<string>();
  private lastActivity = this.startedAt;
  private lastFfmpegLog: string | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(assetUrls: string[]) {
    this.assetUrls = assetUrls;
  }

  /**
   * Reports the environment and starts watching for stalls.
   */
  start() {
    this.send("info", "Render started");
    this.timer = setInterval(this.check, CHECK_INTERVAL_MS);
  }

  /**
   * Stops watching. A render that has finished, failed or been cancelled cannot stall.
   */
  stop() {
    clearInterval(this.timer);
  }

  /**
   * Records that the render has moved on to a new stage.
   */
  mark(stage: string) {
    this.lastActivity = performance.now();
    this.stages.push({ stage, atMs: Math.round(this.lastActivity - this.startedAt) });
  }

  handleLog = ({ message }: LogEvent) => {
    this.lastActivity = performance.now();
    this.lastFfmpegLog = message;
  };

  private check = () => {
    const stage = this.stages.at(-1)?.stage;
    if (!stage || this.stalledStages.has(stage)) return;
    if (performance.now() - this.lastActivity < STALL_MS) return;
    this.stalledStages.add(stage);
    this.send("warning", `Render stalled while ${stage}`);
  };

  private send(level: LogLevel, message: string) {
    const now = performance.now();
    fetch("/log_error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level,
        message,
        timestamp: new Date().toISOString(),
        render: {
          environment: renderEnvironment(),
          elapsedMs: Math.round(now - this.startedAt),
          idleMs: Math.round(now - this.lastActivity),
          stages: this.stages,
          lastFfmpegLog: this.lastFfmpegLog,
          assets: this.assetUrls.map(assetTiming),
        },
      }),
    }).catch((error) => console.warn("Failed to send render diagnostics:", error));
  }
}

/**
 * How the download of one asset went, as far as the browser recorded it.
 */
function assetTiming(url: string) {
  // The browser adds an entry only once the fetch has settled, so a missing one is still in flight.
  const entry = performance.getEntriesByName(url)[0] as PerformanceResourceTiming | undefined;
  if (!entry) {
    return { url, settled: false };
  }
  return {
    url,
    settled: true,
    durationMs: Math.round(entry.duration),
    transferSize: entry.transferSize,
    status: entry.responseStatus ?? null,
  };
}
