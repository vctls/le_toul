import { separateTrack } from './audio';
import { SeparationModel } from '@/types';

// Mock fetch globally
global.fetch = vi.fn();

describe('Audio Library', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('handles zip response directly', async () => {
        const mockFile = new File(['audio data'], 'test.mp3', { type: 'audio/mp3' });
        const mockZipData = new ArrayBuffer(8);
        const mockBlob = new Blob([mockZipData], { type: 'application/zip' });

        // Mock the initial response as zip
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/zip')
            },
            blob: vi.fn().mockResolvedValue(mockBlob)
        });

        // Mock JSZip behavior
        const mockZip = {
            file: vi.fn().mockReturnValue({
                async: vi.fn().mockResolvedValue(new Blob(['mock audio'], { type: 'audio/wav' }))
            })
        };

        // We need to mock jszip.loadAsync
        const jszip = await import('jszip');
        vi.spyOn(jszip.default, 'loadAsync').mockResolvedValue(mockZip as any);

        const result = await separateTrack(mockFile, 'UVR_MDXNET_KARA_2' as SeparationModel);

        expect(result.backing).toBeInstanceOf(Blob);
        expect(result.vocals).toBeInstanceOf(Blob);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('handles JSON response with polling until zip is ready', async () => {
        const mockFile = new File(['audio data'], 'test.mp3', { type: 'audio/mp3' });
        const mockZipData = new ArrayBuffer(8);
        const mockZipBlob = new Blob([mockZipData], { type: 'application/zip' });

        // Mock the initial response as JSON
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            },
            json: vi.fn().mockResolvedValue({
                finishedTrackURL: 'http://example.com/poll-url'
            })
        });

        // Mock polling responses: first JSON (still processing), then zip (finished)
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            },
            json: vi.fn().mockResolvedValue({ status: 'processing' })
        });

        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/zip')
            },
            blob: vi.fn().mockResolvedValue(mockZipBlob)
        });

        // Mock JSZip behavior
        const mockZip = {
            file: vi.fn().mockReturnValue({
                async: vi.fn().mockResolvedValue(new Blob(['mock audio'], { type: 'audio/wav' }))
            })
        };

        const jszip = await import('jszip');
        vi.spyOn(jszip.default, 'loadAsync').mockResolvedValue(mockZip as any);

        // Start the operation
        const resultPromise = separateTrack(mockFile, 'UVR_MDXNET_KARA_2' as SeparationModel);

        // Fast-forward time to trigger the polling timeout
        await vi.advanceTimersByTimeAsync(30000);

        const result = await resultPromise;

        expect(result.backing).toBeInstanceOf(Blob);
        expect(result.vocals).toBeInstanceOf(Blob);
        expect(fetch).toHaveBeenCalledTimes(3); // Initial + 2 polls
        expect(fetch).toHaveBeenCalledWith('http://example.com/poll-url', {
            cache: 'no-cache'
        });
    });

    it('continues polling until zip response is received', async () => {
        const mockFile = new File(['audio data'], 'test.mp3', { type: 'audio/mp3' });
        const mockZipData = new ArrayBuffer(8);
        const mockZipBlob = new Blob([mockZipData], { type: 'application/zip' });

        // Mock the initial response as JSON
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            },
            json: vi.fn().mockResolvedValue({
                finishedTrackURL: 'http://example.com/poll-url'
            })
        });

        // Mock multiple JSON responses before final zip
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            },
            json: vi.fn().mockResolvedValue({ status: 'processing' })
        });

        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            },
            json: vi.fn().mockResolvedValue({ status: 'processing' })
        });

        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/zip')
            },
            blob: vi.fn().mockResolvedValue(mockZipBlob)
        });

        // Mock JSZip behavior
        const mockZip = {
            file: vi.fn().mockReturnValue({
                async: vi.fn().mockResolvedValue(new Blob(['mock audio'], { type: 'audio/wav' }))
            })
        };

        const jszip = await import('jszip');
        vi.spyOn(jszip.default, 'loadAsync').mockResolvedValue(mockZip as any);

        // Start the operation
        const resultPromise = separateTrack(mockFile, 'UVR_MDXNET_KARA_2' as SeparationModel);

        // Fast-forward time to trigger multiple polling timeouts
        await vi.advanceTimersByTimeAsync(60000); // 2 * 30 seconds

        const result = await resultPromise;

        expect(result.backing).toBeInstanceOf(Blob);
        expect(result.vocals).toBeInstanceOf(Blob);
        expect(fetch).toHaveBeenCalledTimes(4); // Initial + 3 polls
    });

    it('stops polling and reports the error when the job fails', async () => {
        const mockFile = new File(['audio data'], 'test.mp3', { type: 'audio/mp3' });

        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            },
            json: vi.fn().mockResolvedValue({
                finishedTrackURL: 'http://example.com/poll-url'
            })
        });

        // A failed job never produces a zip, so polling has to end here
        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            },
            json: vi.fn().mockResolvedValue({
                status: 'error',
                error: 'Separator ran out of memory'
            })
        });

        await expect(
            separateTrack(mockFile, 'UVR_MDXNET_KARA_2' as SeparationModel)
        ).rejects.toThrow('Separator ran out of memory');

        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('honours the poll interval suggested by the server', async () => {
        const mockFile = new File(['audio data'], 'test.mp3', { type: 'audio/mp3' });
        const mockZipBlob = new Blob([new ArrayBuffer(8)], { type: 'application/zip' });

        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            },
            json: vi.fn().mockResolvedValue({
                finishedTrackURL: 'http://example.com/poll-url'
            })
        });

        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            },
            json: vi.fn().mockResolvedValue({ status: 'processing', pollIntervalSeconds: 3 })
        });

        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/zip')
            },
            blob: vi.fn().mockResolvedValue(mockZipBlob)
        });

        const jszip = await import('jszip');
        vi.spyOn(jszip.default, 'loadAsync').mockResolvedValue({
            file: vi.fn().mockReturnValue({
                async: vi.fn().mockResolvedValue(new Blob(['mock audio'], { type: 'audio/wav' }))
            })
        } as any);

        const resultPromise = separateTrack(mockFile, 'UVR_MDXNET_KARA_2' as SeparationModel);

        // Only the suggested 3 seconds, well short of the 30 second default
        await vi.advanceTimersByTimeAsync(3000);

        await resultPromise;
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('reports the status instead of handing an error page to jszip', async () => {
        const mockFile = new File(['audio data'], 'test.mp3', { type: 'audio/mp3' });

        (fetch as any).mockResolvedValueOnce({
            ok: true,
            headers: {
                get: vi.fn().mockReturnValue('application/json')
            },
            json: vi.fn().mockResolvedValue({
                finishedTrackURL: 'http://example.com/poll-url'
            })
        });

        // Neither JSON nor a successful response, so it cannot be a zip
        (fetch as any).mockResolvedValueOnce({
            ok: false,
            status: 502,
            headers: {
                get: vi.fn().mockReturnValue('text/plain')
            },
            blob: vi.fn().mockResolvedValue(new Blob([]))
        });

        await expect(
            separateTrack(mockFile, 'UVR_MDXNET_KARA_2' as SeparationModel)
        ).rejects.toThrow('502');
    });
});