import { vi } from 'vitest';

// Global mocks for web APIs can go here
vi.mock('libass-wasm', () => {
    return {
        __esModule: true,
        default: vi.fn(function (options) {
            return {
                setTrack: vi.fn(),
                setCurrentTime: vi.fn(),
                setIsPaused: vi.fn(),
                dispose: vi.fn(),
            };
        }),
    };
});