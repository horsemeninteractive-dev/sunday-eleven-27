import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreferencesDialog, lightsNote } from './PreferencesDialog';

/**
 * The settings dialog, as it now is: three tabs rather than four headings in one
 * column.
 *
 * What is worth holding here is not the styling but the two things that make a
 * tabbed dialog better than a long one — that only one group of settings is on
 * the screen at a time, and that the grouping is *named* rather than implied, so
 * a manager looking for the speed a match opens at knows which of the three
 * places to look in. The keys, the roles and the focus come from the app's own
 * tabstrip (`components/Tabs`), which is asserted at the foot rather than
 * re-implemented here.
 *
 * The render below is always the game's *default* state, and that is a property
 * of the test environment rather than a choice: a server render resolves a store
 * hook from the store's initial state (`zustand`'s server snapshot), so seeding
 * the store cannot change what comes out. Anything that varies with a setting is
 * therefore either a pure function — `lightsNote`, below — or a claim about the
 * wiring, which is read off the source.
 */

function render(): string {
  return renderToStaticMarkup(createElement(PreferencesDialog));
}

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the preferences dialog', () => {
  it('offers three named places to look in', () => {
    const html = render();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Preferences"');
    const tabs = [...html.matchAll(/role="tab"([^>]*)>([^<]*)</g)].map((match) => ({
      selected: match[1]!.includes('aria-selected="true"'),
      label: match[2],
    }));
    expect(tabs.map((tab) => tab.label)).toEqual(['Appearance', 'Matches', 'Window']);
    // The first is the one that opens, and exactly one panel exists beside it.
    expect(tabs.filter((tab) => tab.selected).map((tab) => tab.label)).toEqual(['Appearance']);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(1);
  });

  it('keeps the other tabs out of the document rather than out of sight', () => {
    // Four headings was a page to be scanned; a tab that is merely hidden is
    // still a tab that a screen reader and find-on-page will walk into, so the
    // settings of the other two are not rendered at all.
    const html = render();
    expect(html).toContain('Lights');
    expect(html).toContain('Motion');
    expect(html).not.toContain('Match view');
    expect(html).not.toContain('Fullscreen');
  });

  it('says which way the lights are on, and which answer it was', () => {
    // The one setting that can change while the manager is playing, because
    // "System" is one of the answers — so the sentence says which of the two
    // decided it rather than only what the result is.
    expect(lightsNote('light', 'light')).toBe('The lights are on.');
    expect(lightsNote('dark', 'dark')).toBe('The lights are off.');
    expect(lightsNote('system', 'light')).toBe('Following your system, so the lights are on.');
    expect(lightsNote('system', 'dark')).toBe('Following your system, so the lights are off.');
    // And it is what the dialog actually prints, in the state the dialog opens
    // in: dark, chosen by nobody, so nothing claims the manager's own preference.
    expect(render()).toContain('The lights are off.');
    expect(render()).toContain('A match, a pitch and a photograph are drawn the same way in both');
  });

  it('offers all three answers about the lights', () => {
    const html = render();
    for (const label of ['System', 'Dark', 'Light']) {
      expect(html, `${label} is not offered`).toMatch(new RegExp(`aria-pressed="(?:true|false)"[^>]*>${label}<`));
    }
    // The default one is the one the game is drawn in without being asked.
    expect(html).toMatch(/aria-pressed="true"[^>]*>Dark</);
    // And it is the same setting the speed and the renderer are: one dialog, one
    // place settings are written from.
    const dialog = source('src/ui/dialogs/PreferencesDialog.tsx');
    expect(dialog).toContain('setPreferences({ theme: option.value })');
    expect(dialog).toMatch(/THEME_OPTIONS[^=]*=\s*\[[\s\S]*?value: 'system'[\s\S]*?value: 'dark'[\s\S]*?value: 'light'/);
  });

  it('keeps the reset in the dialog rather than in a tab', () => {
    // It resets all of them, so it cannot live inside one of the three.
    const html = render();
    const reset = html.indexOf('Reset to defaults');
    expect(reset).toBeGreaterThan(html.indexOf('role="tabpanel"'));
    expect(reset).toBeGreaterThan(html.indexOf('</section>'));
  });

  it('builds its tabs from the app\u2019s own tabstrip', () => {
    // So that the arrow keys, the roving tab index and the labelled panel are the
    // same here as on every other tabbed surface, and cannot drift apart.
    const dialog = source('src/ui/dialogs/PreferencesDialog.tsx');
    expect(dialog).toContain("import { Tabs } from '../components/Tabs'");
    expect(dialog).toContain('<Tabs label="Preferences"');
    const tabs = source('src/ui/components/Tabs.tsx');
    expect(tabs).toContain('role="tablist"');
    expect(tabs).toContain("event.key === 'ArrowRight'");
    expect(tabs).toContain('aria-controls={`${id}-panel`}');
  });
});
