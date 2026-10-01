import { describe, expect, it } from 'vitest';
import changelogRaw from '../../CHANGELOG.md?raw';
import { parseChangelog, parseInline } from './changelog';

/**
 * The changelog the game shows is the project's own changelog file, so these
 * tests hold two things down: that the reader understands the four shapes a
 * changelog is made of, and that the real file still parses into them — a
 * changelog that renders as one long paragraph is a changelog nobody reads.
 */

describe('the changelog reader', () => {
  it('reads the shapes a changelog is made of', () => {
    const blocks = parseChangelog(
      [
        '# Changelog',
        '',
        'Some words about the project.',
        '',
        '## [1.2.3] - 2026-01-31 — a name',
        '',
        '### Added',
        '',
        '- **Something** new',
        '- A link to [the docs](https://example.com/docs)',
      ].join('\n'),
    );

    expect(blocks.map((block) => block.kind)).toEqual([
      'title',
      'paragraph',
      'version',
      'section',
      'item',
      'item',
    ]);
    const version = blocks[2]!;
    expect(version.kind === 'version' && version.version).toBe('1.2.3');
    expect(version.kind === 'version' && version.date).toBe('2026-01-31');
    expect(version.kind === 'version' && version.detail).toBe('a name');
  });

  it('keeps the emphasis and the links it is given', () => {
    expect(parseInline('**Added** a link to [the docs](https://example.com) and then words')).toEqual([
      { text: 'Added', bold: true },
      { text: ' a link to ' },
      { text: 'the docs', href: 'https://example.com' },
      { text: ' and then words' },
    ]);
  });

  it('does not turn anything but a real address into a link', () => {
    // A changelog read inside a game should not be able to send anyone
    // anywhere the project did not publish.
    expect(parseInline('[click](javascript:alert(1))')).toEqual([{ text: '[click](javascript:alert(1))' }]);
  });

  it('survives a heading with no version and no date on it', () => {
    const blocks = parseChangelog('## Unreleased\n- A change');
    const version = blocks[0]!;
    expect(version.kind === 'version' && version.version).toBeNull();
    expect(version.kind === 'version' && version.date).toBeNull();
    expect(version.kind === 'version' && version.detail).toBe('Unreleased');
  });

  it('reads the project\u2019s own changelog, and finds this version at the top', () => {
    const blocks = parseChangelog(changelogRaw);
    const versions = blocks.filter((block) => block.kind === 'version');
    expect(versions.length).toBeGreaterThan(0);
    const latest = versions[0]!;
    expect(latest.kind === 'version' && latest.version).toBe('0.1.0');
    expect(blocks.filter((block) => block.kind === 'section').length).toBeGreaterThan(2);
    expect(blocks.filter((block) => block.kind === 'item').length).toBeGreaterThan(20);
    // Every version heading is the only thing on its line, so no stray text.
    expect(latest.kind === 'version' && latest.detail).toBe('first beta');
  });
});
