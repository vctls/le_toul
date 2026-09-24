"""Tests for the line separations wait in for a free slot."""

import asyncio

import pytest

from api.helpers.separation_queue import SeparationQueue, Withdrawn


async def settle():
    """Let every task that can run do so."""
    for _ in range(5):
        await asyncio.sleep(0)


def hold(queue, key, log, release, reports=None):
    """Start a task that takes a slot and keeps it until `release` is set."""

    async def run():
        on_wait = (
            (lambda ahead: reports.append((key, ahead)))
            if reports is not None
            else None
        )
        async with queue.slot(key, on_wait=on_wait):
            log.append(key)
            await release.wait()

    return asyncio.create_task(run())


def test_runs_no_more_than_the_slots_at_once():
    async def scenario():
        queue = SeparationQueue(2)
        log, release = [], asyncio.Event()
        tasks = [hold(queue, key, log, release) for key in "abc"]
        await settle()
        started = list(log)
        release.set()
        await asyncio.gather(*tasks)
        return started, log

    started, finished = asyncio.run(scenario())

    assert started == ["a", "b"]
    assert finished == ["a", "b", "c"]


def test_admits_in_arrival_order():
    async def scenario():
        queue = SeparationQueue(1)
        log = []
        releases = {key: asyncio.Event() for key in "abcd"}
        tasks = [hold(queue, key, log, releases[key]) for key in "abcd"]
        await settle()
        for key in "abcd":
            releases[key].set()
            await settle()
        await asyncio.gather(*tasks)
        return log

    assert asyncio.run(scenario()) == ["a", "b", "c", "d"]


def test_reports_the_songs_ahead_as_the_line_moves():
    async def scenario():
        queue = SeparationQueue(1)
        log, reports = [], []
        releases = {key: asyncio.Event() for key in "abc"}
        tasks = [hold(queue, key, log, releases[key], reports) for key in "abc"]
        await settle()
        releases["a"].set()
        await settle()
        releases["b"].set()
        releases["c"].set()
        await asyncio.gather(*tasks)
        return reports

    assert asyncio.run(scenario()) == [("b", 1), ("c", 2), ("c", 1)]


def test_withdrawn_song_leaves_the_line_and_the_rest_move_up():
    async def scenario():
        queue = SeparationQueue(1)
        log, reports, release = [], [], asyncio.Event()
        tasks = [hold(queue, key, log, release, reports) for key in "abc"]
        await settle()
        assert queue.withdraw("b")
        await settle()
        release.set()
        results = await asyncio.gather(*tasks, return_exceptions=True)
        return log, reports, results

    log, reports, results = asyncio.run(scenario())

    assert log == ["a", "c"]
    assert ("c", 1) in reports
    assert isinstance(results[1], Withdrawn)


def test_withdrawing_a_song_not_in_line_is_harmless():
    async def scenario():
        queue = SeparationQueue(1)
        log, release = [], asyncio.Event()
        task = hold(queue, "a", log, release)
        await settle()
        withdrawn = queue.withdraw("a")
        release.set()
        await task
        return withdrawn, log

    assert asyncio.run(scenario()) == (False, ["a"])


def test_a_failed_separation_frees_its_slot():
    async def scenario():
        queue = SeparationQueue(1)

        async def fail():
            async with queue.slot("a"):
                raise RuntimeError("boom")

        with pytest.raises(RuntimeError):
            await fail()

        async with queue.slot("b"):
            return "b ran"

    assert asyncio.run(scenario()) == "b ran"


def test_a_cancelled_waiter_gives_up_its_place():
    async def scenario():
        queue = SeparationQueue(1)
        log, release = [], asyncio.Event()
        tasks = [hold(queue, key, log, release) for key in "abc"]
        await settle()
        tasks[1].cancel()
        await settle()
        release.set()
        await asyncio.gather(*tasks, return_exceptions=True)
        return log

    assert asyncio.run(scenario()) == ["a", "c"]


def test_a_failing_report_does_not_stall_the_line():
    async def scenario():
        queue = SeparationQueue(1)
        log, release = [], asyncio.Event()

        async def waiter():
            def explode(ahead):
                raise OSError("disk full")

            async with queue.slot("b", on_wait=explode):
                log.append("b")

        first = hold(queue, "a", log, release)
        await settle()
        second = asyncio.create_task(waiter())
        await settle()
        release.set()
        await asyncio.gather(first, second)
        return log

    assert asyncio.run(scenario()) == ["a", "b"]


def test_needs_at_least_one_slot():
    with pytest.raises(ValueError):
        SeparationQueue(0)
