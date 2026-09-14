import { Ref, ref, watch, onScopeDispose } from 'vue';

// The URL fragment for each step. The first is the landing step when the fragment is absent or names no known step.
export const TAB_IDS = [
    'help',
    'song',
    'lyrics',
    'timing',
    'adjust',
    'edit',
    'submit',
] as const;

export type TabId = (typeof TAB_IDS)[number];

export function isTabId(value: unknown): value is TabId {
    return typeof value === 'string' && (TAB_IDS as readonly string[]).includes(value);
}

function tabFromHash(): TabId | null {
    const id = window.location.hash.replace(/^#/, '');
    return isTabId(id) ? id : null;
}

function writeHash(id: TabId): void {
    // replaceState rather than a hash assignment, so stepping through the wizard doesn't
    // stack a history entry per tab and doesn't re-enter the hashchange handler.
    window.history.replaceState(window.history.state, '', `#${id}`);
}

export function useTabRoute(): {
    activeTab: Ref<TabId>;
    setActiveTab: (id: string | number | null | undefined) => void;
} {
    const activeTab = ref<TabId>(tabFromHash() ?? TAB_IDS[0]);

    watch(activeTab, writeHash);

    function syncFromHash(): void {
        const id = tabFromHash();
        if (id !== null) {
            activeTab.value = id;
        } else if (window.location.hash) {
            // A fragment naming no known step would otherwise sit in the address
            // bar contradicting the step we are on.
            writeHash(activeTab.value);
        }
    }

    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    onScopeDispose(() => window.removeEventListener('hashchange', syncFromHash));

    // Buefy clears its model when no tab item matches it, which would wipe the fragment.
    function setActiveTab(id: string | number | null | undefined): void {
        if (isTabId(id)) activeTab.value = id;
    }

    return { activeTab, setActiveTab };
}
