import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

import { separateTrack, TrackSeparationResult } from '@/lib/audio';
import { SeparationModel } from '@/types';
import jsmediatags from "@/jsmediatags.min.js";
import { persistJsonRef, persistBlobRef, clearPersistence } from '@/lib/persistence';

const MEDIA_LOCALSTORAGE_KEYS = [
    'media.youtubeUrl',
    'media.separationModel',
    'media.songTitle',
    'media.songArtist',
    'media.songDuration',
];
const MEDIA_IDB_KEYS = [
    'media.songFile',
    'media.backgroundVideo',
    'media.separatedTrack',
    'media.timingsFile',
    'media.backingTrackFile',
];


export interface SeparatedTrack {
    // Blob URL of the separated backing track
    backing: Blob;
    // Blob URL of the separated vocals track
    vocals: Blob;
}

export const BACKING_VOCALS_SEPARATOR_MODEL = "UVR_MDXNET_KARA_2.onnx";
export const NO_VOCALS_SEPARATOR_MODEL = "UVR-MDX-NET-Inst_HQ_3.onnx";
// Keep backing vocals, higher quality. Minutes per song on CPU, fast on GPU.
export const BACKING_VOCALS_HQ_SEPARATOR_MODEL = "mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt";
export const BACKING_VOCALS_HQ_ALT_SEPARATOR_MODEL = "mel_band_roformer_karaoke_becruily.ckpt";
// Remove backing vocals, highest reported SDR. Heaviest model.
export const NO_VOCALS_HQ_SEPARATOR_MODEL = "model_bs_roformer_ep_317_sdr_12.9755.ckpt";

export const useMediaStore = defineStore('media', () => {
    // The mixed song file (uploaded by user)
    const songFile = ref<File | null>(null);

    // Background video (if the song is from YouTube)
    const backgroundVideo = ref<Blob | null>(null);

    // Files surfaced in the "Advanced" section of SongInfoTab. The semantic
    // state they map to (timings array, separatedTrack.backing) is held
    // elsewhere; these refs exist so the FileUpload widgets can re-display the
    // user's selection after a reload.
    const timingsFile = ref<File | null>(null);
    const backingTrackFile = ref<File | null>(null);

    // Song metadata
    const songTitle = ref<string | null>(null);
    const songDuration = ref<number | null>(null);
    const songArtist = ref<string | null>(null);
    const youtubeUrl = ref<string | null>(null);

    // Track separation state
    const isProcessing = ref(false);
    const separationModel = ref<SeparationModel>(BACKING_VOCALS_SEPARATOR_MODEL);
    const separatedTrack = ref<SeparatedTrack | null>(null);
    const error = ref<string | null>(null);
    const separationStartTime = ref<Date | null>(null);

    async function startSeparation(inputData: any, modelName: SeparationModel): Promise<SeparatedTrack> {
        if (isProcessing.value) {
            return;
        }
        isProcessing.value = true;
        error.value = null;
        separationStartTime.value = new Date();
        try {
            const result = await separateTrack(inputData, modelName);
            separatedTrack.value = result;
            return separatedTrack.value;
        } catch (err) {
            console.error(err);
            error.value = (err as Error).message;
        } finally {
            isProcessing.value = false;
        }
    };

    async function setBackingTrack(file: File) {
        if (separatedTrack.value == null) {
            separatedTrack.value = { backing: file, vocals: new Blob() };
        } else {
            separatedTrack.value.backing = file;
        }
    }

    async function duration(songFile: File): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (event) => {
                try {
                    const audioContext = new AudioContext();
                    const arrayBuffer = event.target.result as ArrayBuffer;

                    audioContext.decodeAudioData(
                        arrayBuffer,
                        (audioBuffer) => {
                            const duration = audioBuffer.duration;
                            resolve(duration);
                        },
                        (error) => {
                            console.error("Error decoding audio data:", error);
                            reject(
                                new Error(
                                    "Failed to decode audio data: " +
                                    (error?.message || "Unknown error")
                                )
                            );
                        }
                    );
                } catch (error) {
                    console.error("Audio context error:", error);
                    reject(
                        new Error(
                            "Failed to create or use AudioContext: " +
                            (error?.message || "Unknown error")
                        )
                    );
                }
            };

            reader.onerror = (event) => {
                console.error("FileReader error:", reader.error);
                reject(
                    new Error(
                        "Failed to read audio file: " +
                        (reader.error?.message || "Unknown error")
                    )
                );
            };

            reader.readAsArrayBuffer(songFile);
        });
    };

    async function getMetadata(songFile: File): Promise<{ title: string | null; artist: string | null }> {
        return new Promise((resolve, reject) => {
            if (!songFile) {
                resolve({ title: null, artist: null });
                return;
            }
            jsmediatags.read(songFile, {
                async onSuccess(tag) {
                    resolve({ title: tag.tags.title, artist: tag.tags.artist });
                },
                onFailure(error) {
                    console.error(error);
                    reject(
                        new Error(
                            "Failed to read metadata: " +
                            (error?.message || "Unknown error")
                        )
                    );
                },
            });
        });
    }

    // While persisted blobs are being read from IDB, the songFile ref may flip
    // from null to a restored File. Suppress metadata re-derivation during that
    // window so the persisted (and possibly user-edited) title/artist/duration
    // aren't overwritten by re-reading the file's embedded tags.
    let isHydrating = true;

    // flush: 'sync' so the isHydrating check runs in the same tick as the
    // hydration assignment to songFile.value, before any later microtask can
    // flip the flag.
    watch(songFile, async (newFile) => {
        if (isHydrating) return;
        if (!newFile) {
            songTitle.value = null;
            songArtist.value = null;
            songDuration.value = null;
            return;
        }
        const [metadata, durationValue] = await Promise.all([
            getMetadata(newFile),
            duration(newFile),
        ]);
        songTitle.value = metadata.title || songTitle.value;
        songArtist.value = metadata.artist || songArtist.value;
        songDuration.value = durationValue;
    }, { flush: 'sync' });

    // JSON-serializable state → localStorage (synchronous load)
    persistJsonRef('media.youtubeUrl', youtubeUrl);
    persistJsonRef('media.separationModel', separationModel);
    persistJsonRef('media.songTitle', songTitle);
    persistJsonRef('media.songArtist', songArtist);
    persistJsonRef('media.songDuration', songDuration);

    // Blobs → IndexedDB (async load)
    Promise.all([
        persistBlobRef('media.songFile', songFile),
        persistBlobRef('media.backgroundVideo', backgroundVideo),
        persistBlobRef('media.separatedTrack', separatedTrack),
        persistBlobRef('media.timingsFile', timingsFile),
        persistBlobRef('media.backingTrackFile', backingTrackFile),
    ]).finally(() => {
        isHydrating = false;
    });

    async function clearSession(): Promise<void> {
        songFile.value = null;
        backgroundVideo.value = null;
        separatedTrack.value = null;
        timingsFile.value = null;
        backingTrackFile.value = null;
        songTitle.value = null;
        songArtist.value = null;
        songDuration.value = null;
        youtubeUrl.value = null;
        error.value = null;
        separationStartTime.value = null;
        await clearPersistence(MEDIA_LOCALSTORAGE_KEYS, MEDIA_IDB_KEYS);
    }

    return {
        // Media files
        songFile,
        backgroundVideo,
        timingsFile,
        backingTrackFile,

        songTitle,
        songArtist,
        songDuration,
        youtubeUrl,

        // Track separation
        isProcessing,
        separationModel,
        separatedTrack,
        error,
        separationStartTime,

        // Methods
        startSeparation,
        setBackingTrack,
        clearSession,
    };
});

// Fake API call to demonstrate functionality
async function fakeMusicSeparationAPI(inputData: any) {
    return new Promise<string>((resolve) => {
        setTimeout(() => {
            resolve('instrumental.wav');
        }, 2000);
    });
}
