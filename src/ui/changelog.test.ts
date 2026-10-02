import { describe, expect, it } from 'vitest';
import changelogRaw from '../../CHANGELOG.md?raw';
import { parseChangelog, parseInline } from './changelog';
import { VERSION } from '@/version';

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

  it('joins a hard-wrapped entry back into one block', () => {
    // The changelog is wrapped like any other markdown file, so nearly every
    // entry in it is several lines long. Read line by line rather than block by
    // block, a paragraph arrives as one block per line and a bullet arrives as a
    // bullet followed by a stack of loose words — which is exactly how it
    // looked in the game before this was fixed.
    const blocks = parseChangelog(
      [
        '## [1.0.0] - 2026-02-01 — wrapped',
        '',
        'A sentence that has been',
        'wrapped over several lines',
        'because the file is.',
        '',
        '### Something',
        '',
        '- **A thing** happened, and',
        '  the rest of the bullet is on',
        '  lines of its own.',
        '- A second bullet.',
      ].join('\n'),
    );

    expect(blocks.map((block) => block.kind)).toEqual([
      'version',
      'paragraph',
      'section',
      'item',
      'item',
    ]);
    // One paragraph, not three.
    const text = (index: number): string => {
      const block = blocks[index]!;
      if (block.kind === 'version' || block.kind === 'title') return '';
      return block.parts.map((part) => part.text).join('');
    };
    expect(text(1)).toBe('A sentence that has been wrapped over several lines because the file is.');
    // One bullet, with its own words and no loose remainder.
    const bullet = blocks[3]!;
    expect(bullet.kind === 'item' && bullet.parts[0]).toEqual({ text: 'A thing', bold: true });
    expect(text(3)).toBe('A thing happened, and the rest of the bullet is on lines of its own.');
    expect(text(4)).toBe('A second bullet.');
  });

  it('reads the project\u2019s own changelog, and finds this version at the top', () => {
    const blocks = parseChangelog(changelogRaw);
    const versions = blocks.filter((block) => block.kind === 'version');
    expect(versions.length).toBeGreaterThan(1);
    // The running build is the one the changelog calls "this build", so the
    // first *numbered* version in the file must be the version `package.json`
    // carries. An "Unreleased" section above it is finished work not yet
    // versioned, and must not take that place: it would label the heading the
    // build is not on, and stamp the actual build with nothing at all.
    const latest = versions.find(
      (block) => block.kind === 'version' && block.version !== 'Unreleased',
    )!;
    expect(latest.kind === 'version' && latest.version).toBe(VERSION);
    expect(blocks.filter((block) => block.kind === 'section').length).toBeGreaterThan(2);
    expect(blocks.filter((block) => block.kind === 'item').length).toBeGreaterThan(20);
    // Every version heading is the only thing on its line, so what is left of it
    // is the release's own title and nothing else. Asserted as a shape rather
    // than as this release's exact words, so publishing a new version does not
    // mean editing the test that guards the changelog.
    const detail = latest.kind === 'version' ? latest.detail : '';
    expect(detail).not.toBe('');
    expect(detail).toBe(detail.trim());
    expect(detail).not.toMatch(/^[-—–\s]|[-—–\s]$/);
  });

  it('keeps an Unreleased section readable, and above the build it describes', () => {
    const blocks = parseChangelog(
      [
        '## [Unreleased]',
        '',
        '### Added',
        '',
        '- Work that is done but not yet in a version.',
        '',
        '## [1.0.0] - 2026-02-01 — released',
        '',
        '- The version that shipped.',
      ].join('\n'),
    );

    const headings = blocks.filter((block) => block.kind === 'version');
    expect(headings[0]!.kind === 'version' && headings[0]!.version).toBe('Unreleased');
    // No date on an unreleased section, and no leftover punctuation from the
    // em dash convention the released headings use.
    expect(headings[0]!.kind === 'version' && headings[0]!.date).toBeNull();
    expect(headings[0]!.kind === 'version' && headings[0]!.detail).toBe('');
    expect(headings[1]!.kind === 'version' && headings[1]!.version).toBe('1.0.0');
  });
});
