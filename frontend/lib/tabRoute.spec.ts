import { effectScope, nextTick } from "vue";
import { TAB_IDS, isTabId, useTabRoute } from "./tabRoute";

function withScope<T>(fn: () => T): { result: T; stop: () => void } {
    const scope = effectScope();
    const result = scope.run(fn) as T;
    return { result, stop: () => scope.stop() };
}

function setHash(hash: string): void {
    window.history.replaceState(null, '', hash === '' ? window.location.pathname : `#${hash}`);
}

beforeEach(() => {
    setHash('');
});

test('isTabId', () => {
    expect(isTabId('adjust')).toBe(true);
    expect(isTabId('nope')).toBe(false);
    expect(isTabId(undefined)).toBe(false);
});

test('starts on the tab named by the fragment', () => {
    setHash('adjust');
    const { result: { activeTab }, stop } = withScope(useTabRoute);
    expect(activeTab.value).toBe('adjust');
    stop();
});

test('falls back to the first tab when the fragment is absent or unknown', () => {
    const { result: bare, stop: stopBare } = withScope(useTabRoute);
    expect(bare.activeTab.value).toBe(TAB_IDS[0]);
    stopBare();

    setHash('not-a-tab');
    const { result: unknown, stop: stopUnknown } = withScope(useTabRoute);
    expect(unknown.activeTab.value).toBe(TAB_IDS[0]);
    expect(window.location.hash).toBe(`#${TAB_IDS[0]}`);
    stopUnknown();
});

test('leaves the fragment out of a bare URL', () => {
    const { stop } = withScope(useTabRoute);
    expect(window.location.hash).toBe('');
    stop();
});

test('writes the fragment when the tab changes', async () => {
    const { result: { setActiveTab }, stop } = withScope(useTabRoute);
    setActiveTab('submit');
    await nextTick();
    expect(window.location.hash).toBe('#submit');
    stop();
});

test('ignores a cleared model value so the fragment survives', async () => {
    setHash('lyrics');
    const { result: { activeTab, setActiveTab }, stop } = withScope(useTabRoute);
    setActiveTab(undefined);
    await nextTick();
    expect(activeTab.value).toBe('lyrics');
    expect(window.location.hash).toBe('#lyrics');
    stop();
});

test('restores the fragment when it is changed to an unknown step', async () => {
    setHash('lyrics');
    const { result: { activeTab }, stop } = withScope(useTabRoute);
    setHash('not-a-tab');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await nextTick();
    expect(activeTab.value).toBe('lyrics');
    expect(window.location.hash).toBe('#lyrics');
    stop();
});

test('follows the fragment when it changes underneath', async () => {
    const { result: { activeTab }, stop } = withScope(useTabRoute);
    setHash('edit');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await nextTick();
    expect(activeTab.value).toBe('edit');
    stop();
});
