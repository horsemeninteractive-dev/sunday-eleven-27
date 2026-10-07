import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '@/domain/person';
import { listProfiles } from './managerProfiles';
import { addDays } from '@/simulation/calendar';
import { currentScore } from '@/simulation/match/core';
import { fullTimeOutcome, fullTimeTalkMoraleDelta } from '@/simulation/match/preparation';
import { nextFixtureFor } from '@/simulation/schedule';
import { clubKit } from '@/ui/kit';
import { useGameStore } from './gameStore';
import { currentLiveEngine } from './liveEngine';

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

describe('a match that cannot be fielded', () => {
  it('abandons the fixture when the manager plays with fewer than seven available', () => {
    const game = newCareer('store-forfeit');
    const match = nextFixtureFor(game, game.userClubId, game.date)!;
    game.date = match.date;
    // Five players on the books: no team to put out.
    game.clubs[game.userClubId]!.squadIds = game.clubs[game.userClubId]!.squadIds.slice(0, 5);

    useGameStore.getState().startUserMatch();

    const after = useGameStore.getState();
    // No match to watch: the fixture is settled and the manager is handed back.
    expect(after.session).toBeNull();
    const played = after.game!.matches[match.id]!;
    expect(played.played).toBe(true);
    expect(played.status).toBe('finished');
    // The opposition is awarded the win, so whichever end the manager is at, his
    // own side has nil.
    const mine = played.homeClubId === game.userClubId ? played.result!.homeGoals : played.result!.awayGoals;
    const theirs = played.homeClubId === game.userClubId ? played.result!.awayGoals : played.result!.homeGoals;
    expect(mine).toBe(0);
    expect(theirs).toBe(3);
    expect(after.notice).toMatch(/awarded/i);
  });
});

describe('the store clock', () => {
  it('starts a career on a Monday in pre-season week', () => {
    const game = newCareer('store-start');
    expect(useGameStore.getState().view).toBe('dashboard');
    expect(new Date(`${game.date}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('remembers the manager once a career begins, so the next one need not be retyped', () => {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, String(value)),
      removeItem: (key: string) => map.delete(key),
    });

    const store = useGameStore.getState();
    store.beginSetup('career');
    store.setManagerProfile({
      firstName: 'Dave',
      surname: 'Fletcher',
      nickname: 'Fletch',
      birthday: '1984-05-02',
      occupation: 'Scaffolder',
      hometown: 'Wychavon',
    });
    expect(listProfiles()).toEqual([]);

    store.createDraft('manager-remembered');
    useGameStore.getState().chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);

    const remembered = listProfiles();
    expect(remembered).toHaveLength(1);
    expect(remembered[0]!.profile.firstName).toBe('Dave');
    expect(remembered[0]!.profile.nickname).toBe('Fletch');
    vi.unstubAllGlobals();
  });

  it('runs the quiet days and stops on the day worth stopping on', async () => {
    const game = newCareer('store-continue');
    // Moving the clock is asynchronous: it stands between fixtures so the
    // progress dialog can move. Awaiting it is how a caller knows it is done.
    await useGameStore.getState().continueGame();
    const after = useGameStore.getState().game!;
    const notice = useGameStore.getState().notice ?? '';
    expect(after.date > game.date).toBe(true);
    expect(notice).toMatch(/Training tonight/);
    // It stopped *on* Thursday rather than reporting it afterwards.
    expect(new Date(`${after.date}T00:00:00Z`).getUTCDay()).toBe(4);
  });

  it('moves exactly one day at a time', async () => {
    const game = newCareer('store-one-day');
    await useGameStore.getState().advanceDays(1);
    expect(useGameStore.getState().game!.date).toBe(addDays(game.date, 1));
    await useGameStore.getState().advanceDays(3);
    expect(useGameStore.getState().game!.date).toBe(addDays(game.date, 4));
  });

  it('refuses to step past an unplayed match', async () => {
    const game = newCareer('store-blocked');
    const fixture = nextFixtureFor(game, game.userClubId, game.date)!;
    await useGameStore.getState().jumpToDate(fixture.date);
    const atMatch = useGameStore.getState().game!;
    expect(atMatch.date).toBe(fixture.date);

    // Now standing on matchday with the game unplayed: neither control will
    // move the clock, because there is something to do first.
    await useGameStore.getState().advanceDays(1);
    expect(useGameStore.getState().game!.date).toBe(fixture.date);
    await useGameStore.getState().continueGame();
    expect(useGameStore.getState().game!.date).toBe(fixture.date);
    expect(useGameStore.getState().notice ?? '').toMatch(/against|Home|Away/i);
  });

  it('jumps to a date, simulating the days in between', async () => {
    const game = newCareer('store-jump');
    const target = addDays(game.date, 5);
    await useGameStore.getState().jumpToDate(target);
    expect(useGameStore.getState().game!.date).toBe(target);
  });

  it('refuses a date in the past, and one absurdly far away', async () => {
    const game = newCareer('store-jump-guard');
    await useGameStore.getState().jumpToDate(addDays(game.date, -2));
    expect(useGameStore.getState().game!.date).toBe(game.date);
    expect(useGameStore.getState().error).toMatch(/already been/i);

    await useGameStore.getState().jumpToDate(addDays(game.date, 200));
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
  async function inTheDressingRoom(seed: string) {
    const game = newCareer(seed);
    const fixture = nextFixtureFor(game, game.userClubId, game.date)!;
    await gameStore().jumpToDate(fixture.date);
    gameStore().startUserMatch();
    return { fixture, session: gameStore().session! };
  }

  const gameStore = () => useGameStore.getState();

  it('opens a match at the speed the manager asked for, not at 1x', async () => {
    gameStore().setPreferences({ defaultMatchSpeed: 4 });
    const { session } = await inTheDressingRoom('matchday-speed');
    expect(session.speed).toBe(4);
    // The controls still change it once it is running.
    gameStore().setMatchSpeed(1);
    expect(gameStore().session!.speed).toBe(1);
    gameStore().setPreferences({ defaultMatchSpeed: 1 });
  });

  it('opens in the dressing room rather than on the pitch', async () => {
    const { session } = await inTheDressingRoom('matchday-pre');
    expect(session.phase).toBe('pre-match');
    expect(session.live.status).toBe('scheduled');
    expect(session.live.minute).toBe(0);
    expect(gameStore().view).toBe('match');
    // Nothing has been played yet, so the calendar has not moved on.
    expect(gameStore().game!.matches[session.matchId]!.played).toBe(false);
  });

  it('shows the match through either renderer without touching it', async () => {
    await inTheDressingRoom('matchday-renderer');
    gameStore().kickOff();
    for (let i = 0; i < 5; i += 1) gameStore().tickMatch();

    const before = gameStore().session!;
    const clock = before.live.minute;
    expect(gameStore().preferences.renderer).toBe('2d');

    // Choosing another view is a preference, not a match control: the session is
    // the same object, still on the same minute, at the same speed, unpaused.
    gameStore().setPreferences({ renderer: '3d' });
    expect(gameStore().preferences.renderer).toBe('3d');
    expect(gameStore().session).toBe(before);
    expect(gameStore().session!.phase).toBe(before.phase);
    expect(gameStore().session!.speed).toBe(before.speed);
    expect(gameStore().session!.paused).toBe(before.paused);
    expect(gameStore().session!.live.events.length).toBe(before.live.events.length);
    expect(gameStore().session!.live.minute).toBe(clock);

    gameStore().setPreferences({ renderer: '2d' });
    expect(gameStore().preferences.renderer).toBe('2d');
  });

  it('watches a finished match back from its own record', async () => {
    const { session } = await inTheDressingRoom('matchday-replay');
    const matchId = session.matchId;
    gameStore().kickOff();
    gameStore().simulateMatchToEnd();
    expect(gameStore().game!.matches[matchId]!.events.length).toBeGreaterThan(0);

    const from = gameStore().view;
    gameStore().openReplay(matchId);
    expect(gameStore().view).toBe('replay');
    expect(gameStore().replay?.matchId).toBe(matchId);

    // Closing it returns to the screen it was opened from, and forgets it.
    gameStore().closeReplay();
    expect(gameStore().view).toBe(from);
    expect(gameStore().replay).toBeNull();
  });

  it('will not replay a fixture with nothing in it', async () => {
    const { session } = await inTheDressingRoom('matchday-replay-empty');
    const before = gameStore().view;
    gameStore().openReplay(session.matchId);
    expect(gameStore().view).toBe(before);
    expect(gameStore().replay).toBeNull();
  });

  it('stops the picture dead when the match is paused, and starts it again', async () => {
    await inTheDressingRoom('matchday-picture-pause');
    gameStore().kickOff();
    gameStore().tickMatch();
    const live = gameStore().session!.live;
    const clock = currentLiveEngine()!.getState().clock;

    gameStore().toggleMatchPause();
    expect(gameStore().session!.paused).toBe(true);
    // However much time the pump hands over, a paused match does not move, and
    // the football is left exactly where it was.
    for (let i = 0; i < 10; i += 1) gameStore().advanceSpatial(0.1);
    expect(currentLiveEngine()!.getState().clock).toBe(clock);
    expect(gameStore().session!.live).toBe(live);

    gameStore().toggleMatchPause();
    gameStore().advanceSpatial(0.1);
    expect(currentLiveEngine()!.getState().clock).toBeGreaterThan(clock);
  });

  it('watches the same football however much of it is shown', async () => {
    // The split in one test: two identical careers, the same fixture, watched
    // under two viewing modes. The whole point is that the *presentation* changes
    // and the *football* does not — a goal in the full match is the same goal at
    // the same second in the key-moments one, because both are the engine's.
    const watchToHalfTime = async (mode: 'full' | 'key') => {
      await inTheDressingRoom('matchday-viewing');
      gameStore().kickOff();
      gameStore().setViewingMode(mode);
      let frames = 0;
      while (gameStore().session!.phase === 'in-progress' && frames < 5000) {
        gameStore().advanceSpatial(1);
        frames += 1;
      }
      const match = gameStore().session!.live;
      return {
        frames,
        events: match.events.map((event) => `${event.second}:${event.type}:${event.playerId ?? ''}`),
        half: match.half,
      };
    };

    const full = await watchToHalfTime('full');
    const key = await watchToHalfTime('key');

    // Both reached the interval — the engine sets `half` to 2 as the first half
    // ends — and the record is identical, however it was watched.
    expect(full.half).toBe(2);
    expect(key.half).toBe(2);
    expect(key.events).toEqual(full.events);
    // And the presentation genuinely differs: key moments reach the interval in
    // far fewer frames, because it skips the ordinary play the full match spends.
    expect(key.frames).toBeLessThan(full.frames);
  });

  it('fast-forwards the presentation without skipping the record', async () => {
    await inTheDressingRoom('matchday-skip');
    gameStore().kickOff();
    gameStore().setViewingMode('key');
    // A few seconds of ordinary play first, so there is something to skip from.
    for (let i = 0; i < 3; i += 1) gameStore().advanceSpatial(0.1);
    const before = currentLiveEngine()!.getState().clock;

    gameStore().skipToNextHighlight();
    // Pump a handful of frames; the cursor should race ahead of the slow rate.
    for (let i = 0; i < 8; i += 1) gameStore().advanceSpatial(0.5);
    const after = currentLiveEngine()!.getState().clock;

    expect(after).toBeGreaterThan(before);
    // The engine was taken with the cursor: the clock and the record agree, and
    // the football that was skipped over is still in the record.
    expect(gameStore().session!.live.events.length).toBeGreaterThan(0);
    expect(gameStore().session!.live.footballSeconds).toBeCloseTo(after, 3);
  });

  it('tells the screen when a line is said, not only when a minute is decided', async () => {
    // This is the bug that made the commentary bar look broken. The pitch moves
    // the live match *in place*, so nothing in the store changed and React was
    // never told — the bar could only redraw when `tickMatch` decided a whole
    // minute, which at 1x is every six seconds. A pass would go on the pitch and
    // the bar would sit on its old line, describing a move seconds gone.
    await inTheDressingRoom('matchday-commentary-told');
    gameStore().kickOff();
    gameStore().tickMatch();

    const live = gameStore().session!.live;
    const before = live.commentary?.length ?? 0;
    const revision = gameStore().session!.revision;

    // Pump frames until the pitch says something.
    let told = before;
    for (let frame = 0; frame < 400 && told === before; frame += 1) {
      gameStore().advanceSpatial(0.2);
      told = gameStore().session!.live.commentary?.length ?? 0;
    }
    expect(told).toBeGreaterThan(before);
    // The screen was told, so the bar has something new to draw.
    expect(gameStore().session!.revision).toBeGreaterThan(revision);
  });

  it('starts the clock only when the manager kicks off', async () => {
    await inTheDressingRoom('matchday-kickoff');
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

  it('stops at half time and waits for the manager', async () => {
    await inTheDressingRoom('matchday-half');
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

  it('lets him say something at half time, and it lands as they go back out', async () => {
    await inTheDressingRoom('matchday-halftime-talk');
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

  it('gives him the last word at full time, and it lands on the whole squad', async () => {
    await inTheDressingRoom('matchday-fulltime-talk');
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

  it('takes a full-time talk only once it is full time', async () => {
    await inTheDressingRoom('matchday-fulltime-guard');
    gameStore().setFullTimeTalk('praise');
    expect(gameStore().session!.fullTimeTalk).toBeNull();

    gameStore().kickOff();
    gameStore().setFullTimeTalk('praise');
    expect(gameStore().session!.fullTimeTalk).toBeNull();
  });

  it('runs to the final whistle and hands the week back', async () => {
    const { session } = await inTheDressingRoom('matchday-full');
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

  it('lets the XI be changed before kick-off without spending a substitution', async () => {
    const { session } = await inTheDressingRoom('matchday-swap');
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
