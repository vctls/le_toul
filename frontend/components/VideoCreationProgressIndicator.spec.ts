import { shallowMount } from '@vue/test-utils';
import VideoCreationProgressIndicator from './VideoCreationProgressIndicator.vue';
import { CreationPhase } from '@/types';

function mountIndicator(props: Record<string, unknown>) {
    return shallowMount(VideoCreationProgressIndicator, {
        props: { phase: CreationPhase.SeparatingVocals, ...props },
    });
}

describe('VideoCreationProgressIndicator', () => {
    it('shows the separation progress the backend reports', () => {
        const wrapper = mountIndicator({
            separationProgress: 0.42,
            separationStage: 'separating the vocals',
        });

        expect(wrapper.text()).toContain('Separating the vocals: 42%');
    });

    it('says the video is waiting on a separation that was already running', () => {
        const wrapper = mountIndicator({ waitingForSeparation: true });

        expect(wrapper.text()).toContain('Waiting for the track separation');
    });

    it('estimates from the elapsed time when the job reports no figure', () => {
        const wrapper = mountIndicator({
            songDuration: 100,
            elapsedTime: 25000,
        });

        expect(wrapper.text()).toContain('25%');
    });

    it('leaves the bar indeterminate with nothing to report or estimate from', () => {
        const wrapper = mountIndicator({});

        expect(wrapper.find('b-progress').attributes('value')).toBeUndefined();
        expect(wrapper.text()).toContain('Separating the vocals...');
    });

    it('reports the render step once the video starts', () => {
        const wrapper = mountIndicator({
            phase: CreationPhase.CreatingVideo,
            progress: 0.5,
            step: 'rendering the video',
        });

        expect(wrapper.text()).toContain('Rendering the video: 50%');
    });
});
