import type { MatchSession, ViewId } from '@/state/gameStore';
import { navSectionFor } from './navigation';

/**
 * What the Android back gesture does.
 *
 * Android has a back gesture or button in its system UI, and every application
 * is expected to have an answer for it. The wrong answer is easy to spot from
 * the outside and impossible to see from a desk: a back press that leaves a
 * dialog open behind the screen it closed, or that quits a match the manager
 * was two minutes into, or that closes the application from a table he was
 * reading. The right answer is that back means *the last thing you opened*, and
 * that pressing it at the very beginning is a polite way of asking to leave.
 *
 * This is the decision, and only the decision. It is a function of three facts
 * about the shell — what is stacked over the screen, which screen it is, and
 * whether a match is being played — so it can be read and tested without a
 * phone, a browser or a running game. The doing of it lives in
 * `src/platform/native.ts`, beside the plugin that reports the gesture.
 *
 * The order is deliberate, and each step is the one a person would expect:
 *
 *   1. anything stacked over the screen goes first — a dialog, the mobile
 *      navigation sheet, a match drawer, the card over a league being played out;
 *   2. the match, which asks before it lets go of an afternoon;
 *   3. a screen reached from another screen, which goes back to the screen it
 *      was reached from — the section's own first screen, which is the parent
 *      the navigation model already describes;
 *   4. and only from a dashboard with nothing open, the application steps aside.
 *
 * Nothing here invents a navigation history. The hierarchy is the one
 * `navigation.ts` already draws: a screen belongs to a section, the first leaf
 * of a section is the section's own screen, and everything else in it is a step
 * further in. That is why back from Tactics lands on the Squad and back from
 * the Squad lands on Home, in both cases on the screen the game already treats
 * as the way in.
 */

export type MatchPhase = MatchSession['phase'];

export interface ShellSnapshot {
  /** How many things are stacked over the screen. See `ui/layers.ts`. */
  layers: number;
  /** The screen showing. */
  view: ViewId;
  /** The phase of the match being played, or null when none is. */
  matchPhase: MatchPhase | null;
}

export type BackAction =
  /** Put away the layer in front: a dialog, a sheet, a drawer. */
  | { kind: 'close-layer' }
  /**
   * Leaving the match does not lose it — the session survives until the
   * application does — but nothing about a match in progress is written to
   * disk, so it asks. See `ANDROID.md`.
   */
  | { kind: 'ask-to-leave-match' }
  /** Full time: the same "back to the club" the full-time card offers. */
  | { kind: 'finish-match' }
  /** Leave the replay and return to the screen it was opened from. */
  | { kind: 'leave-replay' }
  /** The club-design flow, which goes back the way its own Back button does. */
  | { kind: 'abandon-draft' }
  /** Back a step, in the model the navigation already describes. */
  | { kind: 'navigate'; to: ViewId }
  /** Nothing left to close or go back to: the application steps aside. */
  | { kind: 'background' };

/**
 * The screen one step back from this one.
 *
 * `null` when there is nowhere in particular to land: the menu the manager
 * started from, or a screen that belongs to no section — the kit planner is
 * the one such screen, and it is reached from the club's own page.
 */
export function backParentFor(view: ViewId): ViewId | null {
  if (view === 'start') return null;
  // Who you are comes before choosing a club, and a manager who backs out of
  // the flow has already said who he is: `abandonDraft` is that same decision,
  // made by the screens' own Back buttons.
  if (view === 'profile') return 'start';
  if (view === 'select-club' || view === 'create-club') return null;
  const section = navSectionFor(view);
  if (!section) return 'dashboard';
  const first = section.leaves[0]!.id;
  if (first !== view) return first;
  // Home is the first leaf of the Home section, and there is nothing behind it.
  // Said here rather than handled by the caller, so that "there is nowhere to
  // go back to" is one answer in one place.
  return view === 'dashboard' ? null : 'dashboard';
}

export function backActionFor(snapshot: ShellSnapshot): BackAction {
  // 1. Whatever is in front goes first, and that includes the navigation sheet:
  //    it is a layer like any other, so "close the menu" needs no special case
  //    here to be tried before anything below it.
  if (snapshot.layers > 0) return { kind: 'close-layer' };

  const { view, matchPhase } = snapshot;

  // 2. The match.
  if (view === 'match' && matchPhase) {
    // At full time the afternoon is already in the career and there is nothing
    // left to lose: back does what the card's own button does, right down to
    // the word said to the players.
    return matchPhase === 'full-time' ? { kind: 'finish-match' } : { kind: 'ask-to-leave-match' };
  }

  if (view === 'replay') return { kind: 'leave-replay' };
  if (view === 'select-club' || view === 'create-club') return { kind: 'abandon-draft' };

  // 3. A step back, in the hierarchy the navigation model already draws.
  const parent = backParentFor(view);
  if (parent && parent !== view) return { kind: 'navigate', to: parent };

  // 4. A dashboard with nothing open. Android's own answer for this is to put
  //    the task in the background rather than to kill it, so a manager who
  //    comes back finds his afternoon where he left it.
  return { kind: 'background' };
}
