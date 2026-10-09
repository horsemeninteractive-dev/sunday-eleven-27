import { describe, expect, it } from 'vitest';
import { backActionFor, backParentFor, type ShellSnapshot } from './back';
import { NAV_SECTIONS } from './navigation';

/**
 * What the Android back gesture means.
 *
 * The gesture is the one piece of the application that cannot be tried on a
 * desk: there is no back button in a browser, and a phone is where it is felt.
 * So what is tested here is the decision rather than the doing of it — which is
 * the whole reason the decision was separated out.
 */

const at = (snapshot: Partial<ShellSnapshot>): ShellSnapshot => ({
  layers: 0,
  view: 'dashboard',
  matchPhase: null,
  ...snapshot,
});

describe('the back gesture', () => {
  it('puts away whatever is in front before it does anything else', () => {
    // A dialog over a match is still a dialog: the first press closes it.
    expect(backActionFor(at({ layers: 1, view: 'match', matchPhase: 'in-progress' }))).toEqual({
      kind: 'close-layer',
    });
    expect(backActionFor(at({ layers: 3, view: 'squad' }))).toEqual({ kind: 'close-layer' });
  });

  it('asks before it lets go of an afternoon', () => {
    // Nothing about a match in progress is written to disk, so leaving one is
    // the only thing in the game that has to be asked about.
    expect(backActionFor(at({ view: 'match', matchPhase: 'in-progress' }))).toEqual({
      kind: 'ask-to-leave-match',
    });
    expect(backActionFor(at({ view: 'match', matchPhase: 'half-time' }))).toEqual({
      kind: 'ask-to-leave-match',
    });
    // The dressing room too: the talk and the team are his, and he has not
    // kicked off. It is a question about leaving, not about losing anything.
    expect(backActionFor(at({ view: 'match', matchPhase: 'pre-match' }))).toEqual({
      kind: 'ask-to-leave-match',
    });
  });

  it('ends the match at full time, the way the full-time card does', () => {
    // At full time the result is already in the career, so there is nothing to
    // lose and nothing to ask: back is the card's own "back to the club".
    expect(backActionFor(at({ view: 'match', matchPhase: 'full-time' }))).toEqual({
      kind: 'finish-match',
    });
  });

  it('leaves a replay for the screen it was opened from', () => {
    // The replay already knows where it came from — `closeReplay` is that
    // decision, and the gesture only has to ask for it.
    expect(backActionFor(at({ view: 'replay' }))).toEqual({ kind: 'leave-replay' });
  });

  it('backs out of the club-design flow the way its own Back button does', () => {
    expect(backActionFor(at({ view: 'select-club' }))).toEqual({ kind: 'abandon-draft' });
    expect(backActionFor(at({ view: 'create-club' }))).toEqual({ kind: 'abandon-draft' });
  });

  it('steps back to the section, and from the section to Home', () => {
    // A screen inside a section goes back to the screen that section opens on.
    expect(backActionFor(at({ view: 'tactics' }))).toEqual({ kind: 'navigate', to: 'squad' });
    expect(backActionFor(at({ view: 'league' }))).toEqual({ kind: 'navigate', to: 'fixtures' });
    expect(backActionFor(at({ view: 'finances' }))).toEqual({ kind: 'navigate', to: 'club' });
    // And a section's own screen goes back to Home, which is where the game
    // starts from.
    expect(backActionFor(at({ view: 'squad' }))).toEqual({ kind: 'navigate', to: 'dashboard' });
    expect(backActionFor(at({ view: 'inbox' }))).toEqual({ kind: 'navigate', to: 'dashboard' });
    expect(backActionFor(at({ view: 'manager' }))).toEqual({ kind: 'navigate', to: 'dashboard' });
  });

  it('takes a step back from the profile, which is the first thing it asks for', () => {
    expect(backActionFor(at({ view: 'profile' }))).toEqual({ kind: 'navigate', to: 'start' });
  });

  it('steps aside from Home with nothing open, rather than ending the game', () => {
    // Android's own answer for a back gesture at the root of a task is to put
    // the task away. Closing the application would lose the manager's place.
    expect(backActionFor(at({ view: 'dashboard' }))).toEqual({ kind: 'background' });
    expect(backActionFor(at({ view: 'start' }))).toEqual({ kind: 'background' });
  });

  it('never asks a screen to go back to itself', () => {
    // A step that lands where it started is a back button that does nothing —
    // and, worse, one that would have to be pressed twice to leave.
    for (const section of NAV_SECTIONS) {
      for (const leaf of section.leaves) {
        expect(backParentFor(leaf.id), `${leaf.id} is its own parent`).not.toBe(leaf.id);
      }
    }
    for (const view of ['squad', 'club', 'fixtures', 'world', 'inbox', 'manager'] as const) {
      expect(backActionFor(at({ view })), `${view} does not move`).toEqual({
        kind: 'navigate',
        to: 'dashboard',
      });
    }
    // Home is the one screen with nothing behind it, and it steps aside rather
    // than sending itself somewhere it already is.
    expect(backActionFor(at({ view: 'dashboard' }))).toEqual({ kind: 'background' });
  });

  it('finds a way back from every screen in the game that has one', () => {
    // A screen with no answer at all would show a back gesture that did nothing,
    // which reads as a freeze. Everything either steps back, is asked about, or
    // ends what it is in.
    const everywhere: ShellSnapshot[] = [
      ...NAV_SECTIONS.flatMap((section) => section.leaves.map((leaf) => at({ view: leaf.id }))),
      at({ view: 'kit' }),
      at({ view: 'match', matchPhase: 'in-progress' }),
      at({ view: 'replay' }),
      at({ view: 'start' }),
      at({ view: 'profile' }),
      at({ view: 'select-club' }),
    ];
    for (const snapshot of everywhere) {
      expect(backActionFor(snapshot), `${snapshot.view} has no way back`).toBeTruthy();
    }
  });
});
