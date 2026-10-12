import { describe, expect, it } from 'vitest';
import type { Club } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { PlayerId } from '@/domain/ids';
import { isPlayer, type Player } from '@/domain/person';
import { POSITIONS, type PositionCode } from '@/domain/positions';
import { clubSignsFromPool, releaseFromClub, aiSigningPlan, AI_CLUBS } from './aiClubs';
import { squadAssessment } from './recruitment/needs';
import { abilityMean } from './queries';
import { positionScore } from './selection';
import { stream } from './rng';
import { AI_SQUAD_MINIMUM } from './season';
import { clubStandardQuality } from './generation/worldGenerator';
import { createTestGame } from './testSupport';

/**
 * What the other thirty-five clubs sign, and why.
 *
 * The AI used to fill every gap with the best footballer in the county whoever
 * he was, and with thirty-six clubs doing it the county's squads drifted into
 * shapes nobody chose: sides with one goalkeeper, no right back and five centre
 * forwards, each summer adding a man they did not need and letting go of one who
 * was not the problem. These pin the three rules that stop it — sign for a hole,
 * do not displace a man who already answers the position, and never turn over
 * more than the club is short of — in the club's own football rather than in a
 * universal ideal of a footballer.
 *
 * Everything here runs against the real world generator and the real pool, so a
 * signing is a signing: a man comes off the unattached list onto a squad list.
 */

const MAX_SEASONAL_TURNOVER = 4;


/** A club the manager is not running. */
function pickAiClub(state: GameState, index = 0): Club {
  const clubs = Object.values(state.clubs)
    .filter((club) => club.active && club.id !== state.userClubId)
    .sort((a, b) => a.id.localeCompare(b.id));
  const club = clubs[index];
  if (!club) throw new Error('no AI club to test with');
  return club;
}

const squadOf = (state: GameState, club: Club): Player[] =>
  club.squadIds.map((id) => state.people[id]).filter(isPlayer);

/** The best anybody at the club is at standing in this position. */
function bestAt(state: GameState, club: Club, position: PositionCode): number {
  return squadOf(state, club).reduce((best, player) => Math.max(best, positionScore(player, position)), 0);
}

/** Send a man out of the world, the way retirement does: over the release age. */
function retire(state: GameState, club: Club, player: Player): void {
  player.age = AI_CLUBS.maxReleasedAge + 2;
  releaseFromClub(state, club, player);
}

describe('an AI club’s summer needs', () => {
  it('signs a goalkeeper for a club with nobody who can keep goal', () => {
    const { state } = createTestGame('ai-signs-a-keeper');
    const clubs = Object.values(state.clubs)
      .filter((entry) => entry.active && entry.id !== state.userClubId)
      .sort((a, b) => a.id.localeCompare(b.id));

    // The club is one whose books would stretch to a keeper: it can only sign a
    // man inside its own band, so the man available has to be one of those —
    // the same rule that stops the county ratcheting upward every summer.
    let club: Club | null = null;
    let keeper: Player | null = null;
    for (const candidate of clubs) {
      const standard = clubStandardQuality(candidate.reputation);
      const found = clubs
        .filter((entry) => entry.id !== candidate.id)
        .flatMap((entry) => squadOf(state, entry))
        .find(
          (player) =>
            player.preferredPosition === 'GK' &&
            abilityMean(player) <= standard &&
            abilityMean(player) >= standard * AI_CLUBS.signingFloor,
        );
      if (found) {
        club = candidate;
        keeper = found;
        break;
      }
    }
    expect(club).not.toBeNull();
    expect(keeper).not.toBeNull();

    // A keeper off somebody else's books, young enough to stay in the game.
    const donor = state.clubs[keeper!.clubId!]!;
    releaseFromClub(state, donor, keeper!);

    // The club's own keepers are gone — retired, out of the game entirely.
    for (const player of squadOf(state, club!).filter((man) => man.preferredPosition === 'GK')) {
      retire(state, club!, player);
    }
    const before = bestAt(state, club!, 'GK');
    const target = club!.squadIds.length + 2;

    const signed = clubSignsFromPool(state, club!, stream(state.seed, 'test', 'keeper'), state.season.startDate, target);

    expect(signed.length).toBeGreaterThan(0);
    // What it signs answers the hole: somebody at the club can now play in goal,
    // and better than the outfield players who were filling in.
    expect(bestAt(state, club!, 'GK')).toBeGreaterThan(before);
    // And the man it took is that keeper, not the best footballer in the pool.
    const arrived = signed.map((id) => state.people[id]).filter(isPlayer);
    expect(arrived.some((player) => positionScore(player, 'GK') >= 0.5)).toBe(true);
    expect(arrived.some((player) => player.notes.some((note) => note.includes('cover goalkeeper')))).toBe(true);
  });

  it('signs nobody when the club is already the size it wants to be', () => {
    const { state } = createTestGame('ai-no-need');
    const club = pickAiClub(state);
    const signed = clubSignsFromPool(state, club, stream(state.seed, 'test', 'none'), state.season.startDate, club.squadIds.length);
    expect(signed).toEqual([]);
  });

  it('signs once, and only for what it cannot cover, when the club is in the red', () => {
    const { state } = createTestGame('ai-strained');
    const club = pickAiClub(state);
    club.finances.balance = -250;
    const target = club.squadIds.length + 4;

    const plan = aiSigningPlan(state, club, target);
    expect(plan.strained).toBe(true);
    expect(plan.shortfall).toBe(4);
    expect(plan.budget).toBe(AI_CLUBS.strainedSignings);

    const signed = clubSignsFromPool(state, club, stream(state.seed, 'test', 'strained'), state.season.startDate, target);
    expect(signed.length).toBeLessThanOrEqual(AI_CLUBS.strainedSignings);
  });

  it('replaces what it has just let go before it changes anything else', () => {
    const { state } = createTestGame('ai-like-for-like');
    const club = pickAiClub(state);

    // Two defenders gone, so the club is genuinely short at the back.
    const defenders = squadOf(state, club).filter((player) => player.positionGroup === 'DEF');
    expect(defenders.length).toBeGreaterThan(2);
    releaseFromClub(state, club, defenders[0]!);
    releaseFromClub(state, club, defenders[1]!);

    const assessment = squadAssessment(state, club.id);
    const plan = aiSigningPlan(state, club, club.squadIds.length + 3, { positions: ['CB', 'CB'] });

    // The reading found the hole at the back...
    expect(assessment.priorities.some((entry) => entry.group === 'DEF')).toBe(true);
    // ...and the club shops for the two centre halves it just let go, in order,
    // rather than for one generic defender.
    expect(plan.replacements.map((entry) => entry.position)).toEqual(['CB', 'CB']);
    expect(plan.replacements[0]!.group).toBe('DEF');
    expect(plan.replacing).toEqual(['CB', 'CB']);
    // The positions it is already replacing are not asked for twice.
    for (const entry of plan.priorities) expect(plan.replacing).not.toContain(entry.position);
    // And its own needs are still behind them, at most one position per area.
    const groups = plan.priorities.map((entry) => entry.group);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it('fills one position per man it let go rather than piling into one area', () => {
    const { state } = createTestGame('ai-spread');
    const club = pickAiClub(state);
    const squad = squadOf(state, club);

    // Four men let go, one from each area of the side, which is the shape of a
    // real summer — and the whole of a summer's allowance. A club free to shop
    // by ability alone would simply take the best footballers in the county, who
    // are not spread across four areas of a side; this one replaces what it
    // lost, once per area.
    const released: Player[] = [];
    for (const group of ['GK', 'DEF', 'MID', 'FWD'] as const) {
      const spare = squad.find(
        (player) => player.positionGroup === group && !released.includes(player) && player.id !== club.managerId,
      );
      if (spare) released.push(spare);
    }
    expect(released.length).toBe(MAX_SEASONAL_TURNOVER);
    for (const man of released) releaseFromClub(state, club, man);

    const target = club.squadIds.length + released.length;
    const signed = clubSignsFromPool(state, club, stream(state.seed, 'test', 'spread'), state.season.startDate, target, {
      cap: 26,
      replaces: released.map((man) => abilityMean(man)),
      positions: released.map((man) => man.preferredPosition),
    });
    expect(signed.length).toBeGreaterThanOrEqual(3);
    expect(signed.length).toBeLessThanOrEqual(AI_CLUBS.maxSigningsPerSeason);
    expect(club.squadIds.length).toBeGreaterThanOrEqual(20);

    const arrived = signed.map((id) => state.people[id]).filter(isPlayer);
    // One position per hole: the club does not fill its left midfield and its
    // centre half with the same kind of footballer, and it does not sign a
    // second man for a position it has already covered this summer.
    const positions = arrived.map((player) => player.notes.at(-1)!.replace(/^Signed for .+ to cover /, '').replace(/\.$/, ''));
    expect(new Set(positions).size).toBe(positions.length);
    // And the areas it lost men from are the areas it signs into: a side that
    // released a keeper, a defender, a midfielder and a forward does not spend
    // the summer buying four defenders.
    const groups = arrived.map((player) => player.positionGroup);
    expect(new Set(groups).size).toBeGreaterThanOrEqual(3);
  });
});

describe('several summers of AI business', () => {
  it('leaves every squad balanced, staffed and no larger than it started', () => {
    const { state } = createTestGame('ai-summers');
    const clubs = Object.values(state.clubs)
      .filter((club) => club.active && club.id !== state.userClubId)
      .sort((a, b) => a.id.localeCompare(b.id));
    const opening = new Map(clubs.map((club) => [club.id, club.squadIds.length]));

    for (let summer = 0; summer < 5; summer += 1) {
      const seasonStart = `${2026 + summer}-07-20`;
      for (const club of clubs) {
        const rng = stream(state.seed, 'ai-summers', String(summer), club.id);
        // The same shape of summer the season loop runs: the club is above the
        // legal minimum — the intake has already been through — and it lets the
        // surplus go and signs back to the size it was.
        const target = Math.min(club.squadIds.length, 26);
        const released: PositionCode[] = [];
        const ratings: number[] = [];
        const spare = club.squadIds.length - AI_SQUAD_MINIMUM;
        const surplus = squadOf(state, club)
          .filter((player) => player.age >= 30 && player.id !== club.managerId)
          .sort((a, b) => b.age - a.age || a.id.localeCompare(b.id));
        for (const man of surplus.slice(0, Math.max(0, Math.min(2, spare)))) {
          released.push(man.preferredPosition);
          ratings.push(abilityMean(man));
          releaseFromClub(state, club, man);
        }
        const signed: PlayerId[] = clubSignsFromPool(state, club, rng, seasonStart, target, {
          cap: 26,
          replaces: ratings,
          positions: released,
        });
        // A club never signs more men in a summer than it let go plus what it is
        // short of, and its own allowance is the hard ceiling.
        expect(signed.length).toBeLessThanOrEqual(AI_CLUBS.maxSigningsPerSeason);
        expect(signed.length).toBeLessThanOrEqual(Math.max(0, target - (club.squadIds.length - signed.length)));
      }
    }

    let withoutAKeeper = 0;
    for (const club of clubs) {
      const squad = squadOf(state, club);
      // Nobody has eaten a squad, and nobody has grown one by signing: the men
      // released are replaced, so five summers of business leave every club the
      // size it was.
      expect(squad.length).toBeGreaterThanOrEqual(AI_SQUAD_MINIMUM);
      expect(squad.length).toBeLessThanOrEqual(26);
      expect(squad.length).toBeLessThanOrEqual(opening.get(club.id)!);
      // Every area of every squad still has real bodies in it, and the side is
      // still a side rather than a pile of one kind of player.
      for (const group of ['GK', 'DEF', 'MID', 'FWD'] as const) {
        const count = squad.filter((player) => player.positionGroup === group).length;
        expect(count, `${club.identity.shortName} has ${count} in ${group}`).toBeGreaterThanOrEqual(1);
      }
      if (bestAt(state, club, 'GK') <= 0.4) withoutAKeeper += 1;
    }

    // The failure the old "best man available" policy produced: a side released
    // its keeper for being thirty-one and then signed a forward, and stayed
    // keeperless for years. It can still happen when the county simply has no
    // keeper of a club's standard to sign, but it is now the exception rather
    // than what a summer does by default.
    expect(withoutAKeeper).toBeLessThanOrEqual(2);
  });

  it('reads a signed man’s own record back to why he was signed', () => {
    const { state } = createTestGame('ai-signing-note');
    const club = pickAiClub(state);
    const signed = clubSignsFromPool(state, club, stream(state.seed, 'test', 'note'), state.season.startDate, club.squadIds.length + 2);
    expect(signed.length).toBeGreaterThan(0);
    for (const id of signed) {
      const man = state.people[id];
      if (!man || !isPlayer(man)) continue;
      expect(man.notes[man.notes.length - 1]).toMatch(/^Signed for .+ to cover .+\.$/);
      expect(man.clubId).toBe(club.id);
    }
  });

  it('names the position it signed him for in football’s own words', () => {
    // The reason on a signing is built from the position table rather than
    // typed out, so a note can never name a position the game does not have.
    const labels = Object.values(POSITIONS).map((position) => position.label.toLowerCase());
    const { state } = createTestGame('ai-signing-words');
    const club = pickAiClub(state);
    const signed = clubSignsFromPool(state, club, stream(state.seed, 'test', 'words'), state.season.startDate, club.squadIds.length + 1);
    expect(signed.length).toBeGreaterThan(0);
    const note = (state.people[signed[0]!] as Player).notes.at(-1)!;
    const covered = note.replace(/^Signed for .+ to cover /, '').replace(/\.$/, '');
    expect(labels).toContain(covered);
  });
});
