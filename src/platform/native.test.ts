import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '@/state/gameStore';
import { nextFixtureFor } from '@/simulation/schedule';
import { layerDepth, pushLayer, resetLayersForTests } from '@/ui/layers';
import { handleBackGesture } from './native';

/**
 * The back gesture, from the outside.
 *
 * `ui/back.test.ts` holds the policy down on its own. This is the other half:
 * that the action the policy chose is the one the game actually performs, on
 * the real store — a policy that decides correctly and then does the wrong
 * thing is the failure a decision-only test could never see.
 *
 * The gesture itself cannot be fired here: there is no back button in a browser
 * and no Android bridge in a test, which is why the shell's one entry point is
 * exported rather than buried in a listener. `startNativeShell` is not run —
 * it does nothing at all off a device — so the plugins are never asked to do
 * anything either.
 */

const store = () => useGameStore.getState();

/** A career, with the manager's next fixture as today's game. */
function careerAtItsNextFixture(seed: string) {
  store().quitToMenu();
  store().createDraft(seed);
  store().chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);
  const game = store().game!;
  const fixture = nextFixtureFor(game, game.userClubId, game.date)!;
  game.date = fixture.date;
  return { game, fixture };
}

beforeEach(() => {
  resetLayersForTests();
  store().quitToMenu();
});

describe('the back gesture', () => {
  it('closes what is in front, once, and touches nothing else', () => {
    let closed = 0;
    pushLayer({ kind: 'modal', close: () => { closed += 1; } });
    store().createDraft('back-closes-layer');
    store().setView('squad');

    handleBackGesture();

    // Asked to close, which is all the gesture can do: React takes the layer off
    // the stack when the state that opened it has been cleared, and until then
    // it is still in front. What must not happen is it being asked twice — a
    // second press inside that window would take the screen behind it too.
    expect(closed).toBe(1);
    expect(layerDepth()).toBe(1);
    handleBackGesture();
    expect(closed).toBe(1);

    // The screen underneath is exactly where it was: both presses were spent on
    // the dialog, not on the navigation.
    expect(store().view).toBe('squad');
  });
});

describe('the back gesture and the match', () => {
  it('asks before leaving a dressing room, and leaves the match alone until told', () => {
    const { game } = careerAtItsNextFixture('back-dressing-room');
    store().startUserMatch();
    expect(store().session?.phase).toBe('pre-match');
    expect(store().view).toBe('match');

    handleBackGesture();

    // Asked, not done: the match is still on the screen and still in memory.
    expect(store().leaveMatchPrompt).toBe(true);
    expect(store().session).not.toBeNull();
    expect(store().view).toBe('match');

    // And the answer to the question is the game's own: leaving goes back to the
    // club, and the match is still waiting to be returned to.
    store().dismissLeaveMatch();
    store().setView('dashboard');
    expect(store().leaveMatchPrompt).toBe(false);
    expect(store().session).not.toBeNull();
    expect(store().game!.pendingMatchId).toBe(game.matches[store().session!.matchId]!.id);
  });

  it('asks again once the football is under way', () => {
    careerAtItsNextFixture('back-in-progress');
    store().startUserMatch();
    store().kickOff();
    expect(store().session?.phase).toBe('in-progress');

    handleBackGesture();

    expect(store().leaveMatchPrompt).toBe(true);
    expect(store().view).toBe('match');
  });

  it('ends the afternoon at full time rather than asking about it', () => {
    careerAtItsNextFixture('back-full-time');
    store().startUserMatch();
    store().kickOff();
    // The whistle has gone: the state the full-time card puts the session in.
    // Set directly because reaching it honestly means playing ninety minutes of
    // football, which is what the match engine's own tests are for.
    useGameStore.setState({ session: { ...store().session!, phase: 'full-time', paused: true } });

    handleBackGesture();

    // Exactly what the card's own "back to the club" does: the session ends and
    // the manager is handed the week back.
    expect(store().session).toBeNull();
    expect(store().view).toBe('dashboard');
    // Nothing was asked, because there was nothing left to lose.
    expect(store().leaveMatchPrompt).toBe(false);
  });

  it('forgets the question when the manager navigates away by another route', () => {
    careerAtItsNextFixture('back-prompt-cleared');
    store().startUserMatch();
    handleBackGesture();
    expect(store().leaveMatchPrompt).toBe(true);

    // The sidebar still works mid-match, and anywhere else he goes the question
    // has been answered by going there.
    store().setView('squad');

    expect(store().leaveMatchPrompt).toBe(false);
  });
});

describe('the back gesture and the screens behind it', () => {
  it('returns a replay to the screen it was opened from', () => {
    store().createDraft('back-replay');
    store().chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);
    const matchId = Object.values(store().game!.matches)[0]!.id;
    // A replay needs a match with a record in it; what is being tested here is
    // where backing out of one lands, which is `closeReplay`'s own decision.
    useGameStore.setState({ replay: { matchId, from: 'fixtures' }, view: 'replay' });

    handleBackGesture();

    expect(store().view).toBe('fixtures');
    expect(store().replay).toBeNull();
  });

  it('backs out of the club-design flow the way its own Back button does', () => {
    store().createDraft('back-draft');
    expect(store().draft).not.toBeNull();

    handleBackGesture();

    expect(store().draft).toBeNull();
    // `abandonDraft` decides between the profile and the menu — a manager who
    // has already said who he is does not want to say it again — and the gesture
    // takes that decision rather than making its own.
    expect(['profile', 'start']).toContain(store().view);
  });

  it('steps back through the navigation, one screen at a time', () => {
    store().createDraft('back-navigation');
    store().chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);

    store().setView('tactics');
    handleBackGesture();
    expect(store().view).toBe('squad');

    handleBackGesture();
    expect(store().view).toBe('dashboard');
  });

  it('leaves the manager where he is when there is nowhere left to go', () => {
    store().createDraft('back-at-home');
    store().chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);
    store().setView('dashboard');
    const before = store().game;

    handleBackGesture();

    // On a device this puts the application aside. Anywhere else there is
    // nothing to do, and — the part that matters — nothing is lost.
    expect(store().view).toBe('dashboard');
    expect(store().game).toBe(before);
  });

  it('does nothing at all before there is a career', () => {
    expect(store().game).toBeNull();
    expect(store().view).toBe('start');

    expect(() => handleBackGesture()).not.toThrow();
    expect(store().view).toBe('start');
  });
});
