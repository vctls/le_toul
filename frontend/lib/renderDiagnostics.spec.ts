import { RenderDiagnostics, STALL_MS } from "./renderDiagnostics";

global.fetch = vi.fn();

function sentReports() {
  return (fetch as any).mock.calls.map(([, init]: [string, RequestInit]) =>
    JSON.parse(init.body as string),
  );
}

describe("RenderDiagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetch as any).mockResolvedValue({});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the environment when the render starts", () => {
    const diagnostics = new RenderDiagnostics([]);
    diagnostics.start();
    diagnostics.stop();

    const [report] = sentReports();
    expect(report.level).toBe("info");
    expect(report.message).toBe("Render started");
    expect(report.render.environment).toHaveProperty("crossOriginIsolated");
    expect(report.render.environment).toHaveProperty("userAgent");
  });

  it("reports a stage that goes quiet for too long, once", () => {
    const diagnostics = new RenderDiagnostics(["https://cdn.example/core.wasm"]);
    diagnostics.start();
    diagnostics.mark("loading FFmpeg");

    vi.advanceTimersByTime(STALL_MS * 3);
    diagnostics.stop();

    const stalls = sentReports().filter((report: any) => report.level === "warning");
    expect(stalls).toHaveLength(1);
    expect(stalls[0].message).toBe("Render stalled while loading FFmpeg");
    expect(stalls[0].render.stages.map(({ stage }: any) => stage)).toEqual(["loading FFmpeg"]);
    expect(stalls[0].render.assets).toEqual([
      { url: "https://cdn.example/core.wasm", settled: false },
    ]);
  });

  it("treats ffmpeg log lines as activity", () => {
    const diagnostics = new RenderDiagnostics([]);
    diagnostics.start();
    diagnostics.mark("rendering the video");

    for (let elapsed = 0; elapsed < STALL_MS * 2; elapsed += STALL_MS / 3) {
      vi.advanceTimersByTime(STALL_MS / 3);
      diagnostics.handleLog({ type: "stderr", message: "frame=1 time=00:00:01.00" });
    }
    diagnostics.stop();

    expect(sentReports().filter((report: any) => report.level === "warning")).toEqual([]);
  });

  it("reports nothing after it is stopped", () => {
    const diagnostics = new RenderDiagnostics([]);
    diagnostics.start();
    diagnostics.mark("writing the input files");
    diagnostics.stop();

    vi.advanceTimersByTime(STALL_MS * 2);

    expect(sentReports()).toHaveLength(1);
  });
});
