import { Ref, watch, toRaw } from 'vue';
import { get, set, del } from 'idb-keyval';

export function persistJsonRef<T>(key: string, ref: Ref<T>): void {
    const stored = localStorage.getItem(key);
    if (stored !== null) {
        try {
            ref.value = JSON.parse(stored) as T;
        } catch (e) {
            console.error(`Failed to load ${key} from localStorage`, e);
        }
    }
    watch(ref, (value) => {
        try {
            if (value === null || value === undefined) {
                localStorage.removeItem(key);
            } else {
                localStorage.setItem(key, JSON.stringify(value));
            }
        } catch (e) {
            console.error(`Failed to save ${key} to localStorage`, e);
        }
    }, { deep: true });
}

export async function persistBlobRef<T>(key: string, ref: Ref<T | null>): Promise<void> {
    watch(ref, async (value) => {
        try {
            if (value === null || value === undefined) {
                await del(key);
            } else {
                // toRaw() unwraps Vue's reactive Proxy. IndexedDB's
                // structured-clone can't serialize proxies.
                await set(key, toRaw(value));
            }
        } catch (e) {
            console.error(`Failed to save ${key} to IDB`, e);
        }
    }, { deep: true });

    try {
        const value = await get(key);
        // Only hydrate if the ref is still in its initial empty state. Avoids
        // clobbering anything the user managed to set during the async load.
        if (value !== undefined && ref.value === null) {
            ref.value = value as T;
        }
    } catch (e) {
        console.error(`Failed to load ${key} from IDB`, e);
    }
}

export function loadJsonFromStorage<T>(key: string, defaultValue: T): T {
    try {
        const stored = localStorage.getItem(key);
        return stored !== null ? (JSON.parse(stored) as T) : defaultValue;
    } catch (e) {
        console.error(`Failed to load ${key} from localStorage`, e);
        return defaultValue;
    }
}

export async function clearPersistence(
    localStorageKeys: string[],
    idbKeys: string[],
): Promise<void> {
    for (const k of localStorageKeys) {
        localStorage.removeItem(k);
    }
    await Promise.all(
        idbKeys.map(async (k) => {
            try {
                await del(k);
            } catch (e) {
                console.error(`Failed to clear ${k} from IDB`, e);
            }
        }),
    );
}
