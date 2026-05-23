import { vi } from 'vitest';

// Global mocks for web APIs can go here
// Define interface for SubtitlesOctopus
interface SubtitlesOctopus {
    setTrack: (subtitles: string) => void;
    setCurrentTime: (time: number) => void;
    setIsPaused: (isPaused: boolean, currentTime: number) => void;
}

vi.mock('libass-wasm', () => {
    return {
        __esModule: true,
        default: vi.fn(function (options) {
            return {
                setTrack: vi.fn(),
                setCurrentTime: vi.fn(),
                setIsPaused: vi.fn(),
            };
        }),
    };
});