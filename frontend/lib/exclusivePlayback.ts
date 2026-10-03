// Several tabs stay mounted at once, each with its own player. A browser gives the media keys to a
// single element per document and picks arbitrarily among the ones that are playing, so two
// players left running both answer the keys.
//
// Registered players yield to whichever one the user last started, and the media session handlers
// follow the last player that takes the keys, so the keys drive the one being listened to.

// What a media element and the Timing tab's Web Audio player have in common.
export interface Playable extends EventTarget {
  readonly paused: boolean;
  play(): Promise<void>;
  pause(): void;
}

export interface PlayerOptions {
  // Whether starting this player points the media keys at it.
  mediaKeys?: boolean;
  // Whether the player's tab is shown. The media keys don't reach a player out of sight, since
  // the tabs stay mounted and a key could start one the user can't see.
  isShown?: () => boolean;
}

const players = new Map<Playable, PlayerOptions>();
let current: Playable | null = null;
let actionHandlersBound = false;

export function registerPlayer(player: Playable, options: PlayerOptions = {}): () => void {
  players.set(player, options);
  const onPlay = () => {
    pauseOthers(player);
    if (options.mediaKeys !== false) claimMediaKeys(player);
  };
  const onStop = () => syncPlaybackState(player);
  player.addEventListener("play", onPlay);
  player.addEventListener("pause", onStop);
  player.addEventListener("ended", onStop);
  return () => {
    player.removeEventListener("play", onPlay);
    player.removeEventListener("pause", onStop);
    player.removeEventListener("ended", onStop);
    players.delete(player);
    if (current === player) {
      current = null;
    }
  };
}

// Point the media keys at a player the user just operated, without disturbing playback.
// Only ever called from a control the user acted on: a programmatic seek (a source swap,
// a voice change) happens on hidden tabs and must not take the keys away.
export function claimMediaKeys(player: Playable): void {
  current = player;
  bindActionHandlers();
  syncPlaybackState(player);
}

function pauseOthers(player: Playable): void {
  for (const other of players.keys()) {
    if (other !== player && !other.paused) {
      other.pause();
    }
  }
}

/**
 * The player the media keys point at, if it is shown.
 */
function shownCurrent(): Playable | null {
  if (!current) return null;
  const isShown = players.get(current)?.isShown;
  return !isShown || isShown() ? current : null;
}

function bindActionHandlers(): void {
  if (actionHandlersBound || !("mediaSession" in navigator)) {
    return;
  }
  const set = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Browsers reject actions they don't implement.
    }
  };
  set("play", () => {
    shownCurrent()
      ?.play()
      .catch((error) => console.error("Could not start playback:", error));
  });
  set("pause", () => shownCurrent()?.pause());
  set("stop", () => shownCurrent()?.pause());
  actionHandlersBound = true;
}

function syncPlaybackState(player: Playable): void {
  if (player !== current || !("mediaSession" in navigator)) {
    return;
  }
  navigator.mediaSession.playbackState = player.paused ? "paused" : "playing";
}
