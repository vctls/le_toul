import {
  RenderProgress,
  getAlternateTrackParams,
  getFfmpegParams,
  getMkvMuxParams,
  parseYouTubeTitle,
  fetchYouTubeVideo,
} from "./video";

// Mock fetch globally
global.fetch = vi.fn();

const METADATA = { artist: "The Bolks", title: "Squibble Doo Dah" };
const ALTERNATES = [
  { fileName: "vocals.m4a", title: "Vocals" },
  { fileName: "original.m4a", title: "Original mix" },
];

// The value ffmpeg would read for an argument, e.g. valueOf(args, '-c:a').
function valueOf(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

// The -threads input option ffmpeg would apply to one input: the last one between the previous -i and this one.
function inputThreads(args: string[], input: string): string | undefined {
  const inputIndex = args.findIndex((arg, index) => arg === input && args[index - 1] === "-i");
  const previousInput = args.lastIndexOf("-i", inputIndex - 2);
  const options = args.slice(previousInput + 1, inputIndex - 1);
  return valueOf(options.slice(options.lastIndexOf("-threads")), "-threads");
}

describe("getAlternateTrackParams", () => {
  it("encodes one delayed track on a single thread", () => {
    const args = getAlternateTrackParams("vocals.wav", 2000, "vocals.m4a");

    expect(valueOf(args, "-i")).toBe("vocals.wav");
    // Cover art would otherwise come along as a video stream the m4a muxer rejects.
    expect(valueOf(args, "-map")).toBe("0:a:0");
    expect(valueOf(args, "-af")).toBe("adelay=delays=2000:all=1");
    expect(valueOf(args, "-c:a")).toBe("aac");
    // A second audio encoder in one run deadlocks the WASM core above one thread.
    expect(valueOf(args, "-threads")).toBe("1");
    expect(args.at(-1)).toBe("vocals.m4a");
  });

  it("decodes the track on a single thread", () => {
    const args = getAlternateTrackParams("vocals.flac", 0, "vocals.m4a");

    expect(inputThreads(args, "vocals.flac")).toBe("1");
  });
});

describe("getFfmpegParams", () => {
  it.each([
    ["a background video", true],
    ["a plain background", false],
  ])("decodes the backing track on a single thread over %s", (_, hasVideo) => {
    const args = getFfmpegParams(hasVideo, "0x000000", 0, METADATA);

    expect(inputThreads(args, "audio.mp4")).toBe("1");
  });
});

describe("getMkvMuxParams", () => {
  it("copies the rendered video and labels every audio track", () => {
    const args = getMkvMuxParams(ALTERNATES, METADATA);

    expect(args.at(-1)).toBe("karaoke.mkv");
    expect(args.join(" ")).toContain("-i karaoke.mp4 -i vocals.m4a -i original.m4a");
    expect(args.join(" ")).toContain("-map 0:v -map 0:a -map 1:a -map 2:a");
    expect(valueOf(args, "-c")).toBe("copy");
    expect(valueOf(args, "-metadata:s:a:0")).toBe("title=Backing track");
    expect(valueOf(args, "-metadata:s:a:1")).toBe("title=Vocals");
    expect(valueOf(args, "-metadata:s:a:2")).toBe("title=Original mix");
    expect(valueOf(args, "-disposition:a:0")).toBe("default");
    expect(valueOf(args, "-disposition:a:1")).toBe("0");
    expect(valueOf(args, "-disposition:a:2")).toBe("0");
    expect(valueOf(args, "-disposition:v:0")).toBe("default");
    expect(valueOf(args, "-metadata")).toBe("artist=The Bolks");
  });

  it("leaves out an alternate that never arrived", () => {
    const args = getMkvMuxParams([ALTERNATES[0]], METADATA);

    expect(args.join(" ")).toContain("-map 0:v -map 0:a -map 1:a");
    expect(args).not.toContain("-map 2:a");
    expect(args).not.toContain("-metadata:s:a:2");
  });
});

describe("RenderProgress", () => {
  const RENDER = { phrase: "rendering the video", weight: 0.85 };
  const VOCALS = { phrase: "encoding the vocals track", weight: 0.06 };
  const MUX = { phrase: "writing the MKV", weight: 0.09 };

  // What a run prints once it has encoded `seconds` of media.
  function atSecond(seconds: number) {
    const stamp = new Date(seconds * 1000).toISOString().substring(11, 22);
    return {
      type: "stdout",
      message: `size=     468kB time=${stamp} bitrate= 150.0kbits/s`,
    } as any;
  }

  function record(plan: { phrase: string; weight: number }[], mediaSeconds = 100) {
    const reported: [number, string][] = [];
    const progress = new RenderProgress(plan, mediaSeconds, (value, step) =>
      reported.push([value, step]),
    );
    return { progress, reported, latest: () => reported[reported.length - 1] };
  }

  it("reports a single run against the length it produces", () => {
    const { progress, latest } = record([RENDER]);

    progress.begin(RENDER);
    progress.handleLog(atSecond(50));

    // The only step owns the whole bar, however small its weight reads.
    expect(latest()).toEqual([0.5, "rendering the video"]);
  });

  it("carries later runs on from where the earlier ones finished", () => {
    const { progress, latest } = record([RENDER, VOCALS, MUX]);

    progress.begin(RENDER);
    progress.handleLog(atSecond(100));
    progress.end();
    expect(latest()[0]).toBeCloseTo(0.85);
    expect(latest()[1]).toBe("rendering the video");

    progress.begin(VOCALS);
    progress.handleLog(atSecond(50));
    expect(latest()[0]).toBeCloseTo(0.88);
    expect(latest()[1]).toBe("encoding the vocals track");

    progress.end();
    progress.begin(MUX);
    progress.handleLog(atSecond(100));
    expect(latest()[0]).toBeCloseTo(1);
  });

  it("ignores log lines that carry no timestamp", () => {
    const { progress, reported } = record([RENDER]);

    progress.begin(RENDER);
    reported.length = 0;
    progress.handleLog({ type: "stdout", message: "[libx264 @ 0x1] using SAR=1/1" } as any);

    expect(reported).toEqual([]);
  });

  it("stops at full even when a run overruns the expected length", () => {
    const { progress, latest } = record([RENDER], 10);

    progress.begin(RENDER);
    progress.handleLog(atSecond(30));

    expect(latest()[0]).toBe(1);
  });

  it("still moves when the song duration is unknown", () => {
    const { progress, latest } = record([RENDER], 0);

    progress.begin(RENDER);
    progress.handleLog(atSecond(150));

    expect(latest()[0]).toBeCloseTo(0.5);
  });
});

describe("Video Library", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parseYouTubeTitle handles titles without author info", () => {
    expect(parseYouTubeTitle({ title: "The Bolks singing Squibble Doo Dah" })).toEqual([
      "",
      "The Bolks singing Squibble Doo Dah",
    ]);
  });

  it("parseYouTubeTitle parses author and title correctly", () => {
    const expected = ["The Bolks", "Squibble Doo Dah"];
    expect(parseYouTubeTitle({ author: "The Bolks", title: "Squibble Doo Dah" })).toEqual(expected);
  });

  it("fetchYouTubeVideo throws error when polling endpoint returns error JSON", async () => {
    const mockFetch = fetch as any;

    // Mock initial response with polling URL
    const initialResponse = {
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue("application/json"),
      },
      json: vi.fn().mockResolvedValue({
        finishedDownloadURL: "http://example.com/poll-url",
      }),
    };

    // Mock polling response with error JSON
    const errorResponse = {
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue("application/json"),
      },
      blob: vi.fn().mockResolvedValue(
        new Blob(
          [
            JSON.stringify({
              success: false,
              error: "No route to host - unable to reach: YouTube servers",
            }),
          ],
          { type: "application/json" },
        ),
      ),
    };

    mockFetch
      .mockResolvedValueOnce(initialResponse as any)
      .mockResolvedValueOnce(errorResponse as any);

    await expect(fetchYouTubeVideo("https://www.youtube.com/watch?v=test")).rejects.toThrow(
      "No route to host - unable to reach: YouTube servers",
    );
  });
});
