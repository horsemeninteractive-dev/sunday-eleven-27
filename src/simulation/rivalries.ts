import type { Club, ClubRivalry, RivalryKind } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { ClubId, ISODate } from '@/domain/ids';
import { isCompetitiveMatch, type Match } from '@/domain/match';
import type { GameEvent } from '@/domain/news';
import { createEvent } from './news';
import { stream } from './rng';

/**
 * Bad blood between two clubs.
 *
 * A county of thirty-odd clubs is not a list of strangers: villages a mile apart
 * play each other every season for a century, a cup tie leaves a mark, a club
 * takes another's centre-forward in July. The generator has always given each
 * club its two nearest neighbours as rivals and the crowd has always read the
 * number; what this module adds is that the number *moves* — and that it moves
 * in a way you can explain afterwards.
 *
 * Three rules keep it honest:
 *
 *   - **only football does it.** Every change comes from a match that was played
 *     (a cup tie, a tight game, a thrashing, a red card) or from a signing the
 *     game already recorded. Nothing is assigned at random and no pair of clubs
 *     becomes bitter because the dice said so;
 *   - **it is capped.** One afternoon can add at most twelve points and never
 *     takes a pairing past the ceiling — a rivalry is a slow thing, and a single
 *     result that turned strangers into enemies would be neither;
 *   - **heat cools, ground does not.** The waterline (`baseline`) is what two
 *     clubs are to each other with nothing happening, and only a derby is born
 *     with one worth having. Everything else is heat, and heat is what the close
 *     season takes away — so a rivalry settled down is a rivalry forgotten
 *     rather than one deleted.
 */

/** One afternoon can add this much, whatever happened in it. */
const MAX_SWING_PER_MATCH = 12;
const RIVALRY_CEILING = 98;
/** Below this, with nothing behind it, a pairing stops being a rivalry. */
const FADE_OUT = 8;
/** A meeting this long after the last one counts as "again". */
const REPEAT_WINDOW_DAYS = 42;
/** A season without the fixture: the waterline drifts down. */
const STALE_DAYS = 400;
/** Meetings that mattered before competitive tension becomes an old rivalry. */
const HISTORIC_MEETINGS = 8;

/** What these two clubs are to each other, from either end. */
export function rivalryBetween(state: GameState, a: ClubId, b: ClubId): ClubRivalry | null {
  return state.clubs[a]?.rivalries[b] ?? null;
}

/**
 * The waterline of a pairing.
 *
 * Absent on a relationship written before the model existed, and absent means
 * "whatever it is now" — which is what lets an old career keep exactly the
 * rivalries it had instead of having them all re-guessed as temporary.
 */
export function rivalryBaseline(rivalry: ClubRivalry): number {
  return rivalry.baseline ?? rivalry.intensity;
}

function clampIntensity(value: number): number {
  return Math.max(0, Math.min(RIVALRY_CEILING, Math.round(value)));
}

function dayGap(from: ISODate, to: ISODate): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

export interface RivalryOutcome {
  /** What was added to the heat, after the cap. */
  delta: number;
  /** True when a relationship that did not exist before was started. */
  created: boolean;
  /** The sentence the club's own record gets. */
  note: string;
  kind: RivalryKind;
}

/**
 * What a finished match did to the two clubs' relationship.
 *
 * Returns what happened rather than only writing it, so the day's news can be
 * built from the same reckoning that moved the number, and so its bounds can be
 * tested without reading the state back.
 */
export function applyMatchRivalry(state: GameState, match: Match): { outcome: RivalryOutcome | null; events: GameEvent[] } {
  const none = { outcome: null, events: [] as GameEvent[] };
  if (!match.result || !isCompetitiveMatch(state, match)) return none;

  const home = state.clubs[match.homeClubId];
  const away = state.clubs[match.awayClubId];
  if (!home || !away) return none;

  const cup = state.competitions[match.competitionId]?.kind === 'cup';
  const margin = Math.abs(match.result.homeGoals - match.result.awayGoals);
  const reds = Object.values(match.performances).reduce((total, performance) => total + performance.redCards, 0);
  const existing = home.rivalries[away.id] ?? null;
  const repeated = existing?.lastMetOn ? dayGap(existing.lastMetOn, match.date) <= REPEAT_WINDOW_DAYS : false;
  const rng = stream(state.seed, 'rivalry', match.id);

  let delta = 0;
  const reasons: string[] = [];
  if (cup) {
    // A knockout tie is the one afternoon that can make two clubs care about
    // each other for a decade: somebody goes out of a competition.
    delta += 5;
    reasons.push('a cup tie');
    if (margin <= 1) {
      delta += 2;
      reasons.push('decided by a single goal');
    }
  } else if (margin <= 1) {
    delta += rng.int(1, 3);
    reasons.push('a game that could have gone either way');
  } else if (margin >= 5) {
    delta += 1;
    reasons.push('an afternoon one of them will not forget');
  }
  if (reds > 0) {
    delta += Math.min(4, reds * 2);
    reasons.push(reds === 1 ? 'a red card' : 'two or three of them off');
  }
  if (repeated) {
    delta += 2;
    reasons.push('the second time they have met this month');
  }
  delta = Math.min(MAX_SWING_PER_MATCH, delta);

  // Nothing happened worth remembering, and they were nothing to each other in
  // the first place: the fixture passes without leaving a mark.
  if (!existing && delta < 4) return none;

  const baseline = existing ? rivalryBaseline(existing) : 6;
  const kind: RivalryKind = existing?.kind ?? 'competitive';
  const heat = (existing?.heat ?? 0) + delta;
  const intensity = clampIntensity(baseline + heat);
  const meetings = (existing?.meetings ?? 0) + 1;
  const note = `${home.identity.shortName} against ${away.identity.shortName}: ${reasons.join(', ') || 'another meeting'}.`;
  const changed = delta > 0 || !existing;

  for (const [club, other] of [
    [home, away] as const,
    [away, home] as const,
  ]) {
    const previous = club.rivalries[other.id];
    club.rivalries[other.id] = {
      intensity,
      note: `${other.identity.shortName} against ${club.identity.shortName}: ${reasons.join(', ') || 'another meeting'}.`,
      baseline: previous ? rivalryBaseline(previous) : baseline,
      kind: previous?.kind ?? kind,
      since: previous?.since ?? match.date,
      lastMetOn: match.date,
      meetings,
      heat,
    };
  }

  if (!changed) return none;

  // A relationship that has just changed is worth a line, and a new one more so.
  const importance: 1 | 2 | 3 = delta >= 7 ? 2 : 1;
  const body = cup
    ? `They met in the cup, and it was ${margin <= 1 ? 'as tight as it gets' : 'over well before the end'}. It will not be forgotten at ${delta >= 7 ? 'either club' : 'the losing end'}.`
    : `A ${margin <= 1 ? 'tight' : margin >= 5 ? 'one-sided' : 'hard'} afternoon at ${home.identity.shortName}, and nobody who was there will forget which way it went.`;
  const events: GameEvent[] = [];
  if (delta >= 5 || !existing) {
    events.push(
      createEvent(state, {
        type: 'world',
        importance,
        clubIds: [home.id, away.id],
        matchId: match.id,
        data: {
          headline: delta >= 5 ? `Bad blood between ${home.identity.shortName} and ${away.identity.shortName}` : `${home.identity.shortName} and ${away.identity.shortName} have a history now`,
          body,
          rivalry: intensity,
        },
      }),
    );
  }

  return { outcome: { delta, created: !existing, note, kind }, events };
}

/**
 * The close season.
 *
 * Heat decays and the waterline mostly does not, which is the whole point of
 * having two numbers: two clubs can stop being a fixture without their history
 * being deleted, and a derby is never quietly forgotten. Where a pairing has
 * genuinely built something — enough afternoons that mattered — the waterline
 * rises and it is promoted from this season's bad temper to an old rivalry.
 *
 * Walks each pair once, so the two mirrored records cannot drift apart.
 */
export function coolRivalries(state: GameState, date: ISODate): void {
  const clubs = Object.values(state.clubs);
  for (let i = 0; i < clubs.length; i++) {
    for (let j = i + 1; j < clubs.length; j++) {
      const first = clubs[i]!;
      const second = clubs[j]!;
      const rivalry = first.rivalries[second.id];
      if (!rivalry) continue;

      const baseline = rivalryBaseline(rivalry);
      const cooled = (rivalry.heat ?? 0) * 0.45;
      const drifting = rivalry.lastMetOn ? dayGap(rivalry.lastMetOn, date) > STALE_DAYS : false;
      let nextBaseline = drifting && rivalry.kind !== 'derby' ? Math.max(0, baseline - 2) : baseline;

      const meetings = rivalry.meetings ?? 0;
      const kind: RivalryKind = rivalry.kind ?? (baseline >= 55 ? 'derby' : 'competitive');
      let promoted = kind;
      if (kind === 'competitive' && meetings >= HISTORIC_MEETINGS && nextBaseline >= 25) {
        nextBaseline = Math.min(70, nextBaseline + 4);
        promoted = 'historic';
      }

      const intensity = clampIntensity(nextBaseline + cooled);
      if (intensity < FADE_OUT && promoted === 'competitive') {
        delete first.rivalries[second.id];
        delete second.rivalries[first.id];
        continue;
      }

      for (const [club, other] of [
        [first, second] as const,
        [second, first] as const,
      ]) {
        const previous = club.rivalries[other.id];
        if (!previous) continue;
        club.rivalries[other.id] = {
          ...previous,
          intensity,
          baseline: nextBaseline,
          kind: promoted,
          heat: cooled,
          meetings,
        };
      }
    }
  }
}

/**
 * Something a club did that the other has not forgiven, outside a match.
 *
 * The signing raid the game already models — a club taking another's player —
 * is the one non-match event that has always left a mark, so it goes through the
 * same arithmetic as an afternoon's football rather than writing `intensity`
 * itself. Bounded identically, and heat rather than waterline, because a
 * transfer is a grudge and not a hundred years of geography.
 */
export function applyOffFieldRivalry(club: Club, other: Club, amount: number, note: string, date: ISODate): void {
  const existing = club.rivalries[other.id];
  const baseline = existing ? rivalryBaseline(existing) : 8;
  const heat = (existing?.heat ?? 0) + Math.min(MAX_SWING_PER_MATCH, Math.max(0, amount));
  const intensity = clampIntensity(baseline + heat);
  const mirror = other.rivalries[club.id];
  club.rivalries[other.id] = {
    intensity,
    note,
    baseline,
    kind: existing?.kind ?? 'competitive',
    since: existing?.since ?? date,
    lastMetOn: existing?.lastMetOn ?? null,
    meetings: existing?.meetings ?? 0,
    heat,
  };
  other.rivalries[club.id] = {
    intensity: Math.max(intensity, mirror?.intensity ?? 0),
    note: mirror?.note ?? note,
    baseline: mirror ? rivalryBaseline(mirror) : baseline,
    kind: mirror?.kind ?? 'competitive',
    since: mirror?.since ?? date,
    lastMetOn: mirror?.lastMetOn ?? null,
    meetings: mirror?.meetings ?? 0,
    heat: Math.max(heat, mirror?.heat ?? 0),
  };
}
