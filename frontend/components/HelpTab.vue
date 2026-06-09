<template>
  <b-tab-item label="Introduction" icon="circle-info" class="scroll-wrapper">
    <div class="content">
      <p>
        <strong>Step 1: Choose a music file.</strong> Click the
        <code>Song File</code> tab and pick your song via a YouTube URL or local
        file. Easy. Click `Start Separation` to start the process of creating
        the instrumental track while you work on the rest of it.
      </p>
      <p>
        <strong>Step 2: Prepare the lyrics.</strong> Paste song lyrics into the
        <code>Lyrics</code> box. Next, divide them up into screens by adding a
        blank line between the last line of one screen and the first line of the
        next. Add underscores to separate words, and slashes to separate syllables.
        How precisely you want to split up your timings is up to you.
        Following the rhythm in the next screen may be easier when syllables are
        correctly defined.
        <strong>Pro tip:</strong> listen to the song once while reading
        the lyrics, to make sure all the lyrics are there. Sometimes the
        Internet is wrong, and changing the lyrics after entering the timings might
        mess up your data, forcing you to redo the whole timing input process.
      </p>
      <p>
        <strong>Step 3: Add Timing Information.</strong> You're gonna tell The
        Tüül when all those lyrics appear in the song. When you hit the Play
        button, the song will start playing, and the first lyric-bit that you
        chopped up will be highlighted in pink.
        <strong>Hit the spacebar</strong> when that lyric comes up, and then the
        next lyric will turn pink and await your spacebar-press.
      </p>
      <p>
        If you hit the <strong>Enter</strong> key while the song is playing,
        that will mark the end of the <strong>previous</strong> lyric. Do that
        when there's a gap between lines or words. It can be tricky to handle
        both the spacebar and the enter key. If the song is going too fast, slow
        it down by clicking a different playback speed.
      </p>
      <p>
        If you need to take a break, hit the Pause button.
        Don't worry if you can't get the timings exactly right. You can make finer
        adjustments in the next screen.
      </p>
      <p>
        <strong>Step 5: Adjust timings.</strong> Head to
        the Adjust tab to preview your track. If any of the timings seem off,
        drag the edges of that lyric until the timing is better.
      </p>
      <p>
        If your song has multiple voices, you will have to do the whole timing
        process for each voice. The voice to work on will be selectable from
        the upper right menu, next to the title of the Song Timing, Adjust and
        Edit tabs.
        If you want to have perfectly matching unison, you can copy-paste blocks
        of timings between voices using the Edit tab.
      </p>
      <p>
        <strong>Step 6: Create The Video.</strong> After you've given an Enter
        press to the last lyric in the song, you can watch the preview, fiddle
        with fonts and colors, and click the <code>Submit</code> button. Wait
        5-10 minutes. Eventually you'll be asked to download a zip file. Inside
        that zip is an <code>.mp4</code> file which is your karaoke video! The
        zip file also includes generated <code>subtitles.ass</code> and
        <code>timings.json</code> files that were used to make your video. You
        can upload them to the Song Info tab if you want to re-do your video
        without re-doing the timings.
      </p>
    </div>
  </b-tab-item>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({});
</script>
