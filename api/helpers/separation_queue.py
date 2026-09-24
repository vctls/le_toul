"""Admits separations a few at a time, in the order they arrived.

Separations running together share one machine's CPU and memory, so each runs
slower than it would alone, and enough of them exhaust the memory ceiling.
A waiting song is a future on the event loop rather than a blocked thread, so
a long line cannot starve the thread pool that serves downloads.

The limit is per process, so it multiplies with the gunicorn worker count.
"""

import asyncio
import contextlib
from collections.abc import AsyncIterator, Callable

import structlog

logger = structlog.get_logger(__name__)

# Called with the number of songs ahead, running or waiting.
AheadCallback = Callable[[int], None]


class Withdrawn(Exception):
    """Raised in a waiter whose place in line was given up."""


class _Waiter:
    def __init__(self, key: str, on_wait: AheadCallback | None):
        self.key = key
        self.on_wait = on_wait
        self.admitted: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        self.last_ahead: int | None = None


class SeparationQueue:
    def __init__(self, slots: int):
        if slots < 1:
            raise ValueError(f"A separation queue needs at least one slot, not {slots}")
        self._slots = slots
        self._running = 0
        self._waiting: list[_Waiter] = []

    @contextlib.asynccontextmanager
    async def slot(
        self, key: str, on_wait: AheadCallback | None = None
    ) -> AsyncIterator[None]:
        """Hold a slot for the duration of the block, waiting in line for one if none is free.

        on_wait is told how many songs are ahead each time that number changes,
        and never once the slot is held.
        Raises Withdrawn if the key is withdrawn while it waits.
        """
        if self._running < self._slots and not self._waiting:
            self._running += 1
        else:
            waiter = _Waiter(key, on_wait)
            self._waiting.append(waiter)
            self._report_positions()
            try:
                await waiter.admitted
            except BaseException:
                if waiter in self._waiting:
                    self._waiting.remove(waiter)
                    self._report_positions()
                elif _was_handed_a_slot(waiter.admitted):
                    # The slot arrived in the same tick the task was cancelled.
                    self._release()
                raise

        try:
            yield
        finally:
            self._release()

    def withdraw(self, key: str) -> bool:
        """Take a waiting song out of line, returning whether it was waiting."""
        for waiter in self._waiting:
            if waiter.key == key:
                self._waiting.remove(waiter)
                waiter.admitted.set_exception(Withdrawn())
                self._report_positions()
                return True
        return False

    def _release(self) -> None:
        if self._waiting:
            # The slot passes straight to the next in line, so the running count stays put.
            self._waiting.pop(0).admitted.set_result(None)
            self._report_positions()
        else:
            self._running -= 1

    def _report_positions(self) -> None:
        for index, waiter in enumerate(self._waiting):
            ahead = self._running + index
            if waiter.on_wait is None or waiter.last_ahead == ahead:
                continue
            waiter.last_ahead = ahead
            # A failed report must not stop the slot changing hands.
            try:
                waiter.on_wait(ahead)
            except Exception:
                logger.exception("separation_queue_report_failed", key=waiter.key)


def _was_handed_a_slot(admitted: asyncio.Future[None]) -> bool:
    return admitted.done() and not admitted.cancelled() and admitted.exception() is None
