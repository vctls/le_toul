import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PlayerOptions, claimMediaKeys, registerPlayer } from "./exclusivePlayback";

class FakeMedia extends EventTarget {
  paused = true;

  play = vi.fn(async () => {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
  });

  pause = vi.fn(() => {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  });
}

function fakePlayer(): HTMLMediaElement {
  return new FakeMedia() as unknown as HTMLMediaElement;
}

const actionHandlers = new Map<string, () => void>();
const mediaSession = {
  playbackState: "none",
  setActionHandler: (action: string, handler: () => void) => {
    actionHandlers.set(action, handler);
  },
};

Object.defineProperty(navigator, "mediaSession", { value: mediaSession, configurable: true });

let unregisters: Array<() => void> = [];

function register(media: HTMLMediaElement, options?: PlayerOptions): HTMLMediaElement {
  unregisters.push(registerPlayer(media, options));
  return media;
}

beforeEach(() => {
  mediaSession.playbackState = "none";
});

afterEach(() => {
  unregisters.forEach((unregister) => unregister());
  unregisters = [];
});

describe("registerPlayer", () => {
  it("pauses every other playing player when one starts", async () => {
    const first = register(fakePlayer());
    const second = register(fakePlayer());

    await first.play();
    await second.play();

    expect(first.paused).toBe(true);
    expect(second.paused).toBe(false);
  });

  it("gives the media keys to the player that started last", async () => {
    const first = register(fakePlayer());
    const second = register(fakePlayer());

    await first.play();
    await second.play();
    actionHandlers.get("pause")?.();

    expect(second.paused).toBe(true);
    expect(mediaSession.playbackState).toBe("paused");

    actionHandlers.get("play")?.();

    expect(second.play).toHaveBeenCalledTimes(2);
    expect(first.play).toHaveBeenCalledTimes(1);
  });

  it("leaves the media keys where they were for a player that doesn't take them", async () => {
    const lyrics = register(fakePlayer());
    const timing = register(fakePlayer(), { mediaKeys: false });

    await lyrics.play();
    await timing.play();
    actionHandlers.get("play")?.();

    expect(lyrics.play).toHaveBeenCalledTimes(2);
    expect(timing.paused).toBe(true);
  });

  it("doesn't let the media keys reach a player whose tab isn't shown", async () => {
    let shown = true;
    const player = register(fakePlayer(), { isShown: () => shown });

    await player.play();
    shown = false;
    actionHandlers.get("pause")?.();

    expect(player.paused).toBe(false);
  });

  it("leaves an unregistered player alone", async () => {
    const leaving = fakePlayer();
    const unregister = registerPlayer(leaving);
    const other = register(fakePlayer());

    await leaving.play();
    unregister();
    await other.play();

    expect(leaving.paused).toBe(false);
  });
});

describe("claimMediaKeys", () => {
  it("takes over the keys without stopping what is playing", async () => {
    const playing = register(fakePlayer());
    const seeked = register(fakePlayer());

    await playing.play();
    claimMediaKeys(seeked);

    expect(playing.paused).toBe(false);
    expect(mediaSession.playbackState).toBe("paused");

    actionHandlers.get("play")?.();

    expect(seeked.play).toHaveBeenCalledTimes(1);
  });
});
