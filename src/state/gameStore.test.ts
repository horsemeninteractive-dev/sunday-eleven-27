import { beforeEach, describe, expect, it } from 'vitest';
import type { Player } from '@/domain/person';
import { addDays } from '@/simulation/calendar';
import { currentScore } from '@/simulation/match/engine';
import { fullTimeOutcome, fullTimeTalkMoraleDelta } from '@/simulation/match/preparation';
import { nextFixtureFor } from '@/simulation/schedule';
import { clubKit } from '@/ui/kit';
import { useGameStore } from './gameStore';

/**
 * The Continue button and the calendar's controls are the only ways the manager
 * moves time, so the rules they obey belong in a test rather than in a habit.
 *
 *  - Continue runs the quiet days and stops for anything that matters.
 *  - One day moves exactly one day, and refuses when the day cannot pass.
 *  - Jump to a date does the same, but further.
 */

function newCareer(seed: string) {
  const store = useGameStore.getState();
  store.createDraft(seed);
  store.chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);
  const game = useGameStore.getState().game!;
  return game;
}

beforeEach(() => {
  useGameStore.getState().quitToMenu();
});

describe('the store clock', () => {
  it('starts a career on a Monday in pre-season week', () => {
    const game = newCareer('store-start');
    expect(useGameStore.getState().view).toBe('dashboard');
    expect(new Date(`${game.date}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('runs the quiet days and stops on the day worth stopping on', () => {
    const game = newCareer('store-continue');
    useGameStore.getState().continueGame();
    const after = useGameStore.getState().game!;
    const notice = useGameStore.getState().notice ?? '';
    expect(after.date > game.date).toBe(true);
    expect(notice).toMatch(/Training tonight/);
    // It stopped *on* Thursday rather than reporting it afterwards.
    expect(new Date(`${after.date}T00:00:00Z`).getUTCDay()).toBe(4);
  });

  it('moves exactly one day at a time', () => {
    const game = newCareer('store-one-day');
    useGameStore.getState().advanceDays(1);
    expect(useGameStore.getState().game!.date).toBe(addDays(game.date, 1));
    useGameStore.getState().advanceDays(3);
    expect(useGameStore.getState().game!.date).toBe(addDays(game.date, 4));
  });

  it('refuses to step past an unplayed match', () => {
    const game = newCareer('store-blocked');
    const fixture = nextFixtureFor(game, game.userClubId, game.date)!;
    useGameStore.getState().jumpToDate(fixture.date);
    const atMatch = useGameStore.getState().game!;
    expect(atMatch.date).toBe(fixture.date);

    // Now standing on matchday with the game unplayed: neither control will
    // move the clock, because there is something to do first.
    useGameStore.getState().advanceDays(1);
    expect(useGameStore.getState().game!.date).toBe(fixture.date);
    useGameStore.getState().continueGame();
    expect(useGameStore.getState().game!.date).toBe(fixture.date);
    expect(useGameStore.getState().notice ?? '').toMatch(/against|Home|Away/i);
  });

  it('jumps to a date, simulating the days in between', () => {
    const game = newCareer('store-jump');
    const target = addDays(game.date, 5);
    useGameStore.getState().jumpToDate(target);
    expect(useGameStore.getState().game!.date).toBe(target);
  });

  it('refuses a date in the past, and one absurdly far away', () => {
    const game = newCareer('store-jump-guard');
    useGameStore.getState().jumpToDate(addDays(game.date, -2));
    expect(useGameStore.getState().game!.date).toBe(game.date);
    expect(useGameStore.getState().error).toMatch(/already been/i);

    useGameStore.getState().jumpToDate(addDays(game.date, 200));
    expect(useGameStore.getState().game!.date).toBe(game.date);
    expect(useGameStore.getState().error).toMatch(/closer/i);
  });
});

/**
 * Matchday is an appointment in the calendar, not a separate mode: the match
 * opens in the dressing room, the whistle starts the clock, half time stops it
 * again, and full time gives the week back. Those four moments are the shape of
 * the afternoon, so they are worth pinning down.
 */
describe('the matchday', () => {
  function inTheDressingRoom(seed: string) {
    const game = newCareer(seed);
    const fixture = nextFixtureFor(game, game.userClubId, game.date)!;
    gameStore().jumpToDate(fixture.date);
    gameStore().startUserMatch();
    return { fixture, session: gameStore().session! };
  }

  const gameStore = () => useGameStore.getState();

  it('opens in the dressing room rather than on the pitch', () => {
    const { session } = inTheDressingRoom('matchday-pre');
    expect(session.phase).toBe('pre-match');
    expect(session.live.status).toBe('scheduled');
    expect(session.live.minute).toBe(0);
    expect(gameStore().view).toBe('match');
    // Nothing has been played yet, so the calendar has not moved on.
    expect(gameStore().game!.matches[session.matchId]!.played).toBe(false);
  });

  it('starts the clock only when the manager kicks off', () => {
    inTheDressingRoom('matchday-kickoff');
    gameStore().setWarmUp('intense');
    gameStore().setTeamTalk('motivational');
    gameStore().kickOff();

    const after = gameStore().session!;
    expect(after.phase).toBe('in-progress');
    expect(after.live.status).toBe('in-progress');
    // What he chose in the dressing room is what they walked out with.
    expect(after.warmUp).toBe('intense');
    expect(after.teamTalk).toBe('motivational');
    expect(after.live.events.length).toBeGreaterThan(0);
  });

  it('stops at half time and waits for the manager', () => {
    inTheDressingRoom('matchday-half');
    gameStore().kickOff();

    let guard = 0;
    while (gameStore().session!.phase !== 'half-time' && guard < 200) {
      gameStore().tickMatch();
      guard += 1;
    }
    const half = gameStore().session!;
    expect(half.phase).toBe('half-time');
    expect(half.paused).toBe(true);

    // Poking the clock changes nothing: the fifteen minutes are the manager's.
    gameStore().tickMatch();
    expect(gameStore().session!.phase).toBe('half-time');

    gameStore().resumeSecondHalf();
    expect(gameStore().session!.phase).toBe('in-progress');
    expect(gameStore().session!.paused).toBe(false);
  });

  it('lets him say something at half time, and it lands as they go back out', () => {
    inTheDressingRoom('matchday-halftime-talk');
    gameStore().kickOff();

    let guard = 0;
    while (gameStore().session!.phase !== 'half-time' && guard < 200) {
      gameStore().tickMatch();
      guard += 1;
    }
    const onThePitch = () =>
      gameStore()
        .session!.live.lineups[gameStore().session!.side].starting.map(
          (slot) => gameStore().game!.people[slot.playerId] as { morale: number },
        );
    const before = onThePitch().reduce((sum, player) => sum + player.morale, 0);

    gameStore().setHalfTimeTalk('aggressive');
    expect(gameStore().session!.halfTimeTalk).toBe('aggressive');

    gameStore().resumeSecondHalf();
    expect(gameStore().session!.phase).toBe('in-progress');
    expect(gameStore().notice).toBeTruthy();
    // The words reached the room: somebody in there took them to heart.
    expect(onThePitch().reduce((sum, player) => sum + player.morale, 0)).not.toBe(before);
  });

  it('gives him the last word at full time, and it lands on the whole squad', () => {
    inTheDressingRoom('matchday-fulltime-talk');
    gameStore().kickOff();
    gameStore().simulateMatchToEnd();
    const done = gameStore().session!;
    expect(done.phase).toBe('full-time');

    const lineup = done.live.lineups[done.side];
    const squad = [...lineup.starting, ...lineup.bench];
    const outcome = fullTimeOutcome(currentScore(done.live), done.side);
    // What each of them will be left with, worked out from outside the store.
    const expected = new Map(
      squad.map((slot) => {
        const player = gameStore().game!.people[slot.playerId] as Player;
        const rating = done.live.performances[slot.playerId]?.rating ?? null;
        const delta = fullTimeTalkMoraleDelta('blast', player, { ...outcome, rating });
        return [slot.playerId, Math.max(0, Math.min(100, player.morale + delta))];
      }),
    );
    const before = squad.map((slot) => (gameStore().game!.people[slot.playerId] as Player).morale);

    // The talk is a decision on the day; it is not said until he leaves them.
    gameStore().setFullTimeTalk('blast');
    expect(gameStore().session!.fullTimeTalk).toBe('blast');
    expect(squad.map((slot) => (gameStore().game!.people[slot.playerId] as Player).morale)).toEqual(before);

    gameStore().finishMatchSession();
    expect(gameStore().session).toBeNull();
    expect(gameStore().notice).toBeTruthy();
    for (const slot of squad) {
      expect((gameStore().game!.people[slot.playerId] as Player).morale).toBe(expected.get(slot.playerId));
    }
  });

  it('takes a full-time talk only once it is full time', () => {
    inTheDressingRoom('matchday-fulltime-guard');
    gameStore().setFullTimeTalk('praise');
    expect(gameStore().session!.fullTimeTalk).toBeNull();

    gameStore().kickOff();
    gameStore().setFullTimeTalk('praise');
    expect(gameStore().session!.fullTimeTalk).toBeNull();
  });

  it('runs to the final whistle and hands the week back', () => {
    const { session } = inTheDressingRoom('matchday-full');
    gameStore().kickOff();
    gameStore().simulateMatchToEnd();

    const end = gameStore().session!;
    expect(end.phase).toBe('full-time');
    expect(end.live.result).not.toBeNull();
    // And the fixture the calendar holds is settled, so the season can move on.
    expect(gameStore().game!.matches[session.matchId]!.played).toBe(true);

    gameStore().finishMatchSession();
    expect(gameStore().session).toBeNull();
  });

  it('lets the XI be changed before kick-off without spending a substitution', () => {
    const { session } = inTheDressingRoom('matchday-swap');
    const lineup = session.live.lineups[session.side];
    const substitute = lineup.bench[0]!;
    const starter = lineup.starting[0]!;
    expect(substitute).toBeDefined();

    gameStore().swapSessionPlayers(starter.playerId, substitute.playerId);
    const after = gameStore().session!;
    const changed = after.live.lineups[after.side];
    expect(changed.starting.some((slot) => slot.playerId === substitute.playerId)).toBe(true);
    expect(changed.bench.some((slot) => slot.playerId === starter.playerId)).toBe(true);
    expect(after.live.substitutions[after.side]).toBe(0);
  });
});

/**
 * The kit the club wears is the manager's call, so the action that makes it has
 * to survive a save, a nonsense index and a repeat.
 */
describe('choosing the kit', () => {
  it('wears the design the manager picked, and says what came in', () => {
    const game = newCareer('kit-choice');
    expect(game.clubs[game.userClubId]!.kitChoice ?? 0).toBe(0);

    useGameStore.getState().chooseKit(2);
    const after = useGameStore.getState().game!;
    expect(after.clubs[after.userClubId]!.kitChoice).toBe(2);
    expect(useGameStore.getState().notice ?? '').toMatch(/kit is in/i);
  });

  it('ignores a design that was never offered', () => {
    const game = newCareer('kit-nonsense');
    for (const option of [3, -1, 1.5, Number.NaN]) {
      useGameStore.getState().chooseKit(option);
      const after = useGameStore.getState().game!;
      expect(after.clubs[after.userClubId]!.kitChoice ?? 0).toBe(0);
      expect(after).toBe(game);
    }
  });

  it('gets a fresh set of designs every summer', () => {
    newCareer('kit-season');
    const before = clubKit(useGameStore.getState().game!, useGameStore.getState().game!.userClubId)!;
    useGameStore.getState().rollOverSeason();
    const state = useGameStore.getState().game!;
    const after = clubKit(state, state.userClubId)!;
    expect(after.season).toBe(state.season.label);
    expect(after.season).not.toBe(before.season);
    expect(useGameStore.getState().notice ?? '').toMatch(/new kit/i);
  });
});
