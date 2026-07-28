import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import TimingAdjustmentTab from '@/components/TimingAdjustmentTab.vue';
import { useLyricsStore } from '@/stores/lyrics';
import { useMediaStore } from '@/stores/media';
import { useTimingsStore } from '@/stores/timings';
import { LYRIC_MARKERS } from '@/constants';

const togglePlayPause = vi.fn();
const restartAt = vi.fn();
const seekBy = vi.fn();

// Stands in for the TimingAdjuster the tab drives through its ref.
const timingAdjusterStub = {
    name: 'TimingAdjuster',
    template: '<div class="timing-adjuster-stub" />',
    methods: { togglePlayPause, restartAt, seekBy },
};

// Mounted tabs keep a window keydown listener, so they must be torn down
// between tests or a stale tab answers the key press too.
const mountedTabs: Array<ReturnType<typeof shallowMount>> = [];

function mountTab() {
    const mediaStore = useMediaStore();
    const lyricsStore = useLyricsStore();
    const timingsStore = useTimingsStore();
    mediaStore.songFile = new File(['audio'], 'song.mp3', { type: 'audio/mp3' });
    lyricsStore.setLyrics('hello world');
    timingsStore.resetTimings([
        [0.5, LYRIC_MARKERS.SEGMENT_START],
        [1.5, LYRIC_MARKERS.SEGMENT_END],
    ]);

    const wrapper = shallowMount(TimingAdjustmentTab, {
        global: {
            stubs: {
                TimingAdjuster: timingAdjusterStub,
                // The tab pushes the playhead into this one through a ref.
                SubtitleDisplay: {
                    name: 'SubtitleDisplay',
                    template: '<div />',
                    methods: { setPlayhead: () => { } },
                },
            },
        },
    });
    // The shortcuts only fire while the tab is on screen. happy-dom leaves
    // offsetParent null, so make the root element look displayed.
    Object.defineProperty(wrapper.vm.$el, 'offsetParent', { value: document.body });
    mountedTabs.push(wrapper);
    return wrapper;
}

function pressKey(
    code: string,
    { target = document.body as HTMLElement, shiftKey = false } = {}
) {
    target.dispatchEvent(new KeyboardEvent('keydown', { code, shiftKey, bubbles: true }));
}

describe('TimingAdjustmentTab shortcuts', () => {
    beforeEach(() => {
        localStorage.clear();
        setActivePinia(createPinia());
        togglePlayPause.mockClear();
        restartAt.mockClear();
        seekBy.mockClear();
    });

    afterEach(() => {
        while (mountedTabs.length) {
            mountedTabs.pop()?.unmount();
        }
    });

    it('renders the timing adjuster', () => {
        const wrapper = mountTab();
        expect(wrapper.find('.timing-adjuster-stub').exists()).toBe(true);
    });

    it('toggles playback on spacebar', () => {
        mountTab();
        pressKey('Space');
        expect(togglePlayPause).toHaveBeenCalledOnce();
    });

    it('restarts at the last seeked position on Enter', () => {
        const wrapper = mountTab();
        wrapper.vm.onSeek(12.5);
        // Playback running on past the seek must not move the replay point.
        wrapper.vm.onPlayheadUpdate(20);
        pressKey('Enter');
        expect(restartAt).toHaveBeenCalledWith(12.5);
    });

    it('restarts from the start of the song when nothing has been seeked', () => {
        mountTab();
        pressKey('Enter');
        expect(restartAt).toHaveBeenCalledWith(0);
    });

    it('leaves Enter alone when a button has focus', () => {
        mountTab();
        const button = document.createElement('button');
        document.body.appendChild(button);
        pressKey('Enter', { target: button });
        expect(restartAt).not.toHaveBeenCalled();
        button.remove();
    });

    it('steps by the preroll with the arrow keys, wherever the focus is', () => {
        const wrapper = mountTab();
        wrapper.vm.prerollSeconds = 2;
        pressKey('ArrowRight');
        expect(seekBy).toHaveBeenLastCalledWith(2);
        pressKey('ArrowLeft');
        expect(seekBy).toHaveBeenLastCalledWith(-2);
    });

    it('steps five prerolls at a time with shift held', () => {
        const wrapper = mountTab();
        wrapper.vm.prerollSeconds = 2;
        pressKey('ArrowRight', { shiftKey: true });
        expect(seekBy).toHaveBeenLastCalledWith(10);
        pressKey('ArrowLeft', { shiftKey: true });
        expect(seekBy).toHaveBeenLastCalledWith(-10);
    });

    it('leaves the arrow keys to form controls', () => {
        mountTab();
        for (const tag of ['input', 'select', 'textarea']) {
            const element = document.createElement(tag);
            document.body.appendChild(element);
            pressKey('ArrowRight', { target: element });
            element.remove();
        }
        expect(seekBy).not.toHaveBeenCalled();
    });

    it('takes the keys over from the player when the player has focus', () => {
        mountTab();
        const audio = document.createElement('audio');
        document.body.appendChild(audio);
        pressKey('ArrowRight', { target: audio });
        pressKey('Space', { target: audio });
        expect(seekBy).toHaveBeenCalledWith(1);
        expect(togglePlayPause).toHaveBeenCalledOnce();
        audio.remove();
    });

    // The audio element's built-in controls handle these same keys, and a
    // bubble-phase listener runs after them: verified in Chromium, where the
    // native seek and play/pause still fired on top of ours. Only a
    // capture-phase preventDefault suppresses them.
    it('listens in the capture phase so the player cannot act first', () => {
        const addEventListener = vi.spyOn(window, 'addEventListener');
        mountTab();
        const keydownRegistrations = addEventListener.mock.calls.filter(
            ([type]) => type === 'keydown'
        );
        expect(keydownRegistrations).toHaveLength(1);
        expect(keydownRegistrations[0][2]).toBe(true);
        addEventListener.mockRestore();
    });

    it('keeps a separate replay point per voice', () => {
        const wrapper = mountTab();
        wrapper.vm.onSeek(12.5);
        // Switching voices saves the outgoing voice's state and loads the incoming one's.
        wrapper.vm.$options.watch.activeVoice.call(wrapper.vm, 'voice2', 'voice1');
        pressKey('Enter');
        expect(restartAt).toHaveBeenLastCalledWith(0);

        wrapper.vm.$options.watch.activeVoice.call(wrapper.vm, 'voice1', 'voice2');
        pressKey('Enter');
        expect(restartAt).toHaveBeenLastCalledWith(12.5);
    });
});
