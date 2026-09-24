"""A per-client limit on how many separations can start in a window of time.

The counts live in this process, so they assume the single worker the job
store already requires, and a restart forgets them.
"""

import time
from collections import deque
from collections.abc import Callable

# Past this many clients, a check also forgets every client with no recent start.
_SWEEP_THRESHOLD = 10_000


class RateLimiter:
    def __init__(
        self,
        limits: list[tuple[int, float]],
        clock: Callable[[], float] = time.monotonic,
    ):
        """Allow at most `count` starts in any `seconds`, for each (count, seconds) in limits.

        A count of 0 or less disables its window.
        """
        self._limits = [(count, seconds) for count, seconds in limits if count > 0]
        self._longest = max((seconds for _, seconds in self._limits), default=0)
        self._clock = clock
        self._starts: dict[str, deque[float]] = {}

    def acquire(self, client: str) -> float | None:
        """Record a start for client, or return how many seconds until one is allowed."""
        if not self._limits:
            return None
        now = self._clock()
        if len(self._starts) > _SWEEP_THRESHOLD:
            self._sweep(now)
        starts = self._starts.setdefault(client, deque())
        while starts and starts[0] <= now - self._longest:
            starts.popleft()

        wait = 0.0
        for count, seconds in self._limits:
            recent = [start for start in starts if start > now - seconds]
            if len(recent) >= count:
                wait = max(wait, recent[-count] + seconds - now)
        if wait > 0:
            return wait
        starts.append(now)
        return None

    def _sweep(self, now: float) -> None:
        cutoff = now - self._longest
        for client in [c for c, s in self._starts.items() if not s or s[-1] <= cutoff]:
            del self._starts[client]
