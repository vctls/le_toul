// Several tabs stay mounted at once, each with its own audio element. A browser gives the media
// keys to a single element per document and picks arbitrarily among the ones that are playing,
// so two players left running both answer the keys.
//
// Registered players yield to whichever one the user last started, and the media session handlers
// follow that same player, so the keys drive the one being listened to.

const players = new Set<HTMLMediaElement>();
let current: HTMLMediaElement | null = null;
let actionHandlersBound = false;

export function registerPlayer(media: HTMLMediaElement): () => void {
  players.add(media);
  const onPlay = () => {
    pauseOthers(media);
    claimMediaKeys(media);
  };
  const onStop = () => syncPlaybackState(media);
  media.addEventListener("play", onPlay);
  media.addEventListener("pause", onStop);
  media.addEventListener("ended", onStop);
  return () => {
    media.removeEventListener("play", onPlay);
    media.removeEventListener("pause", onStop);
    media.removeEventListener("ended", onStop);
    players.delete(media);
    if (current === media) {
      current = null;
    }
  };
}

// Point the media keys at a player the user just operated, without disturbing playback.
// Only ever called from a control the user acted on: a programmatic seek (a source swap,
// a voice change) happens on hidden tabs and must not take the keys away.
export function claimMediaKeys(media: HTMLMediaElement): void {
  current = media;
  bindActionHandlers();
  syncPlaybackState(media);
}

function pauseOthers(media: HTMLMediaElement): void {
  for (const other of players) {
    if (other !== media && !other.paused) {
      other.pause();
    }
  }
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
    current?.play().catch((error) => console.error("Could not start playback:", error));
  });
  set("pause", () => current?.pause());
  set("stop", () => current?.pause());
  actionHandlersBound = true;
}

function syncPlaybackState(media: HTMLMediaElement): void {
  if (media !== current || !("mediaSession" in navigator)) {
    return;
  }
  navigator.mediaSession.playbackState = media.paused ? "paused" : "playing";
}
