# Playback measurements

These scripts check that the Timing tab plays exactly the audio drawn under each rectangle, and
that the playhead shows what is being heard. They record what the computer's output actually
plays, while a browser clicks rectangles, then find each sound in the song.

They run on Linux with PipeWire, and need `pw-record` and `pactl`. The Python scripts use the
backend's Poetry environment, which has numpy.

## Files

- `record.py SECONDS NAME` records the default output to `NAME.f32`, and logs when each chunk
  of it arrived, which ties the recording to the system clock.
- `receive.py` saves what the page posts to `http://127.0.0.1:8765/NAME` as
  `NAME_browser.json`, in the directory it runs in.
- `clicks.js` is pasted into the browser. It clicks rectangles one after the other, and logs each
  click and, on every frame, the player's position and where the waveform drew the playhead.
- `analyze.py NAME SONG.f32` compares the recording with the song, rectangle by rectangle.

## Running a measurement

1. Decode the song the project uses to mono at 48 kHz:

   ```sh
   ffmpeg -i tests/fixtures/project/song.mp3 -ac 1 -ar 48000 -f f32le song.f32
   ```

2. In a working directory, start `poetry -C <repo> run python <repo>/tools/playback-measure/receive.py`
   and leave it running. `poetry -C` changes to the repo first, so call the environment's own
   `python` (`poetry env info -p` gives it) to keep the files in the working directory.
3. Open the project's Timing tab in Adjust mode, in a browser driven by a browser tool, such as
   the Firefox or Chrome DevTools MCP servers. Click its Play button once through the tool, and
   pause. That click is a real user gesture. The page's own synthetic clicks aren't, and Firefox
   never starts an AudioContext without one.
4. Start `record.py 40 NAME` in the working directory. It needs about two seconds per rectangle,
   plus their length at the playback rate.
5. Evaluate `window.measureRun = { name: "NAME" }` in the page, then the function in
   `clicks.js`. `segments` in `measureRun` picks other rectangles.
6. Once `NAME_browser.json` has arrived, run `analyze.py NAME song.f32`.

## Reading the results

At 1x, the recording matches the song sample for sample. `start` and `end` say how far each
sound began and stopped from the rectangle's edges, and `match` how well it matched the song
(1.000 is the same samples). Both errors should be 0.0 ms.

At other rates, the loudness envelopes are matched instead. That is good to about a millisecond,
but some rectangles read 10 to 16 ms early whatever the browser, probably because Signalsmith
Stretch spreads their attacks. `lasted` should equal the rectangle's length divided by the rate.

`position` is how far the player's position was ahead of the sound being heard, and `drawn` the
same for the playhead the waveform drew. Both should stay within a few milliseconds.

`click to sound` is the time from the click to the first sound, which includes the output's
latency.

## Latency changes

PipeWire's quantum can be forced to test a change of output latency during a session:

```sh
pw-metadata -n settings 0 clock.force-quantum 2048
pw-metadata -n settings 0 clock.force-quantum 0
```

Start a new recording after each change, since the recorder's timing can't follow it. A change
made while the page's AudioContext runs leaves Firefox's playhead ahead of the sound until the
window loses focus, which closes the context. Dispatching `blur` on the window does the same.
