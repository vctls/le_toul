import { mount } from '@vue/test-utils';
import { vi } from 'vitest';
import SourceFileDownloadLinks from './SourceFileDownloadLinks.vue';

const stubIcons = { stubs: { 'b-icon': true } };

describe('SourceFileDownloadLinks', () => {
  it('lists an uploaded font under its own file name', () => {
    const font = new File(['font bytes'], 'MyFont.ttf');
    const wrapper = mount(SourceFileDownloadLinks, { props: { font }, global: stubIcons });

    expect(wrapper.text()).toContain('MyFont.ttf');
  });

  it('shows nothing when there is no font and no other file', () => {
    const wrapper = mount(SourceFileDownloadLinks, { global: stubIcons });

    expect(wrapper.find('.source-file-links').exists()).toBe(false);
  });

  it('downloads the font under its own file name', async () => {
    const font = new File(['font bytes'], 'MyFont.ttf');
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:font');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('MyFont.ttf');
    });
    const wrapper = mount(SourceFileDownloadLinks, { props: { font }, global: stubIcons });

    await wrapper.find('.file-item a').trigger('click');

    expect(createObjectURL).toHaveBeenCalledWith(font);
    expect(click).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
