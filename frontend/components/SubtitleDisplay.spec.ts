import { shallowMount } from '@vue/test-utils';
import SubtitleDisplay from './SubtitleDisplay.vue';

describe('SubtitleDisplay', () => {
    it('renders', () => {
        const wrapper = shallowMount(SubtitleDisplay, {
            props: {
                subtitles: '',
                fonts: {}
            }
        });
        expect(wrapper.find('canvas.subtitle-canvas').exists()).toBe(true);
    });
});