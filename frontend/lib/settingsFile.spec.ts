import { describe, expect, test } from 'vitest';
import yaml from 'js-yaml';
import Color from 'buefy/src/utils/color';
import { parseSettingsYaml } from './settingsFile';
import { VerticalAlignment } from './timing';
import { BACKING_VOCALS_HQ_SEPARATOR_MODEL, NO_VOCALS_SEPARATOR_MODEL } from '@/stores/media';

// A file shaped exactly like the one the Submit tab exports.
const EXPORTED_FILE = yaml.dump({
  song: {
    title: 'Bohemian Rhapsody',
    artist: 'Queen',
    duration: 354.2,
    youtubeUrl: 'https://youtu.be/fJ9rUzIMcZQ',
  },
  separationModel: NO_VOCALS_SEPARATOR_MODEL,
  videoOptions: {
    addTitleScreen: false,
    addCountIns: false,
    addInstrumentalScreens: true,
    addStaggeredLines: true,
    useBackgroundVideo: true,
    verticalAlignment: VerticalAlignment.Top,
    font: { size: 30, name: 'Impact' },
    color: { background: '#111111', primary: '#222222', secondary: '#333333' },
  },
  voiceStyles: {
    Anna: { fontName: 'Georgia', fontSize: 26, bold: true, primary: '#abcdef' },
  },
});

describe('parseSettingsYaml', () => {
  test('reads back an exported settings file', () => {
    const parsed = parseSettingsYaml(EXPORTED_FILE);

    expect(parsed.warnings).toEqual([]);
    expect(parsed.song).toEqual({
      title: 'Bohemian Rhapsody',
      artist: 'Queen',
      duration: 354.2,
      youtubeUrl: 'https://youtu.be/fJ9rUzIMcZQ',
    });
    expect(parsed.separationModel).toBe(NO_VOCALS_SEPARATOR_MODEL);

    expect(parsed.videoOptions.addTitleScreen).toBe(false);
    expect(parsed.videoOptions.addCountIns).toBe(false);
    expect(parsed.videoOptions.addInstrumentalScreens).toBe(true);
    expect(parsed.videoOptions.addStaggeredLines).toBe(true);
    expect(parsed.videoOptions.useBackgroundVideo).toBe(true);
    expect(parsed.videoOptions.verticalAlignment).toBe(VerticalAlignment.Top);
    expect(parsed.videoOptions.font).toEqual({ size: 30, name: 'Impact' });
    expect(parsed.videoOptions.color?.background).toBeInstanceOf(Color);
    expect(parsed.videoOptions.color?.background.toString()).toBe('#111111');
    expect(parsed.videoOptions.color?.primary.toString()).toBe('#222222');
    expect(parsed.videoOptions.color?.secondary.toString()).toBe('#333333');

    const anna = parsed.voiceStyles?.Anna;
    expect(anna?.fontName).toBe('Georgia');
    expect(anna?.fontSize).toBe(26);
    expect(anna?.bold).toBe(true);
    expect(anna?.primary).toBeInstanceOf(Color);
    expect(anna?.primary?.toString()).toBe('#abcdef');
  });

  test('only reports the settings the file mentions', () => {
    const parsed = parseSettingsYaml('videoOptions:\n  addCountIns: false\n');

    expect(parsed.warnings).toEqual([]);
    expect(parsed.videoOptions).toEqual({ addCountIns: false });
    expect(parsed.song).toEqual({});
    expect(parsed.separationModel).toBeUndefined();
    expect(parsed.voiceStyles).toBeUndefined();
  });

  test('accepts named vertical alignments for hand-written files', () => {
    expect(
      parseSettingsYaml('videoOptions:\n  verticalAlignment: bottom\n').videoOptions.verticalAlignment
    ).toBe(VerticalAlignment.Bottom);
    expect(
      parseSettingsYaml('videoOptions:\n  verticalAlignment: Top\n').videoOptions.verticalAlignment
    ).toBe(VerticalAlignment.Top);
  });

  test('accepts the separation model under the store field name too', () => {
    const parsed = parseSettingsYaml(
      `videoOptions:\n  vocalSeparationModel: ${BACKING_VOCALS_HQ_SEPARATOR_MODEL}\n`
    );

    expect(parsed.warnings).toEqual([]);
    expect(parsed.separationModel).toBe(BACKING_VOCALS_HQ_SEPARATOR_MODEL);
    expect(parsed.videoOptions.vocalSeparationModel).toBe(BACKING_VOCALS_HQ_SEPARATOR_MODEL);
  });

  test('skips entries of the wrong type and reports them', () => {
    const parsed = parseSettingsYaml(
      [
        'videoOptions:',
        '  addCountIns: maybe',
        '  font:',
        '    size: large',
        '    name: Impact',
        '  color:',
        '    primary: not-a-color',
        '    secondary: "#00ff00"',
      ].join('\n')
    );

    expect(parsed.videoOptions.addCountIns).toBeUndefined();
    expect(parsed.videoOptions.font).toEqual({ name: 'Impact' });
    expect(parsed.videoOptions.color?.primary).toBeUndefined();
    expect(parsed.videoOptions.color?.secondary.toString()).toBe('#00ff00');
    expect(parsed.warnings).toHaveLength(3);
    expect(parsed.warnings.join('\n')).toContain('videoOptions.addCountIns');
    expect(parsed.warnings.join('\n')).toContain('videoOptions.font.size');
    expect(parsed.warnings.join('\n')).toContain('videoOptions.color.primary');
  });

  test('reports unknown settings instead of silently dropping them', () => {
    const parsed = parseSettingsYaml('videoOptions:\n  addCountIn: true\nnonsense: 1\n');

    expect(parsed.videoOptions).toEqual({});
    expect(parsed.warnings).toEqual([
      'nonsense: unknown setting, ignoring it',
      'videoOptions.addCountIn: unknown setting, ignoring it',
    ]);
  });

  test('rejects an unknown separation model', () => {
    const parsed = parseSettingsYaml('separationModel: some_other_model.ckpt\n');

    expect(parsed.separationModel).toBeUndefined();
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toContain('unknown separation model');
  });

  test('skips voice styles that are not mappings', () => {
    const parsed = parseSettingsYaml('voiceStyles:\n  Anna: Impact\n  Ben:\n    italic: true\n');

    expect(parsed.voiceStyles).toEqual({ Ben: { italic: true } });
    expect(parsed.warnings).toEqual(['voiceStyles.Anna: expected a mapping, ignoring it']);
  });

  test('throws on a file that is not a settings mapping', () => {
    expect(() => parseSettingsYaml('')).toThrow(/empty/);
    expect(() => parseSettingsYaml('- one\n- two\n')).toThrow(/mapping/);
    expect(() => parseSettingsYaml('videoOptions: [unclosed\n')).toThrow(/Could not parse/);
  });
});
