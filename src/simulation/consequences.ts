import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, PlayerId } from '@/domain/ids';
import { isCompetitiveMatch, type Match, type PlayerPerformance } from '@/domain/match';
import type { GameEvent } from '@/domain/news';
import { isPlayer, type Player, type PlayerHistoryEntry } from '@/domain/person';
import { addDays, formatShortDate } from './calendar';
import { createEvent } from './news';
import {
  applyRelationshipEvent,
  getRelationship,
  moraleInputFromRelationships,
  type RelationshipEventResult,
} from './relationships';
import { stream } from './rng';

/**
 * Turning a finished match into consequences.
 *
 * This is where the world "remembers": records accumulate, bodies tire, form
 * and morale shift, injuries and suspensions land, history is written and news
 * events are produced for the rest of the game to consume.
 */

export function seasonEntryFor(player: Player, seasonLabel: string, clubId: ClubId | null): PlayerHistoryEntry {
  let entry = player.record.seasons.find((season) => season.seasonLabel === seasonLabel);
  if (!entry) {
    entry = {
      seasonLabel,
      clubId,
      appearances: 0,
      substituteAppearances: 0,
      goals: 0,
      assists: 0,
      yellowCards: 0,
      redCards: 0,
    };
    player.record.seasons.push(entry);
  }
  if (clubId && entry.clubId !== clubId) entry.clubId = clubId;
  return entry;
}

function staminaCost(player: Player, minutes: number, position: string): number {
  const staminaFactor = 0.6 + player.attributes.physical.stamina / 20;
  const base = position === 'GK' ? 0.14 : 0.36;
  return (minutes * base) / staminaFactor;
}

function applyCondition(player: Player, performance: PlayerPerformance): void {
  player.fitness = Math.max(18, Math.round((player.fitness - staminaCost(player, performance.minutesPlayed, performance.positionPlayed)) * 10) / 10);

  const formDelta = (performance.rating - 6.4) * 4.2;
  player.form = Math.max(5, Math.min(95, Math.round((player.form + formDelta) * 10) / 10));

  // Consistency matters: inconsistent players swing further from the middle.
  const consistency = player.attributes.hidden.consistency / 20;
  const drift = (50 - player.form) * (0.1 + consistency * 0.06);
  player.form = Math.round((player.form + drift) * 10) / 10;
}

function applyMorale(
  state: GameState,
  player: Player,
  performance: PlayerPerformance,
  result: 'win' | 'draw' | 'loss',
): void {
  let delta = result === 'win' ? 4 : result === 'draw' ? 1 : -3;
  delta += performance.goals * 2;
  delta += (performance.rating - 6.2) * 1.5;
  if (performance.sentOff) delta -= 5;
  if (performance.injuryDetail) delta -= 4;
  // Relationships are one input among several, never the whole story: a player
  // who trusts his manager and is close to the lads carries a little more.
  delta += moraleInputFromRelationships(state, player);
  player.morale = Math.max(15, Math.min(99, Math.round(player.morale + delta)));
}

function applyInjury(player: Player, performance: PlayerPerformance, date: ISODate, events: GameEvent[], state: GameState): void {
  const detail = performance.injuryDetail;
  if (!detail) return;
  player.injury = {
    description: detail.description,
    severity: detail.severity,
    daysOut: detail.daysOut,
    occurredOn: date,
  };
  player.availability = {
    status: 'unavailable',
    reason: 'injury',
    note: `Out with ${detail.description}`,
    until: addDays(date, detail.daysOut),
    discoveredLate: false,
  };
  // Injury news is the manager's own problem; other clubs only make the local
  // news when it is serious enough to be talked about.
  const isUserPlayer = player.clubId === state.userClubId;
  if (isUserPlayer || detail.severity === 'serious') {
    const club = state.clubs[player.clubId ?? ''];
    events.push(
      createEvent(state, {
        type: 'injury',
        importance: detail.severity === 'serious' ? 3 : 2,
        clubIds: player.clubId ? [player.clubId] : [],
        personIds: [player.id],
        data: {
          player: `${player.firstName} ${player.surname}`,
          club: club?.identity.name ?? 'the club',
          description: detail.description,
          daysOut: detail.daysOut,
        },
      }),
    );
  }
}

function applySuspension(
  player: Player,
  performance: PlayerPerformance,
  nextMatchDate: ISODate | null,
  events: GameEvent[],
  state: GameState,
): void {
  if (performance.redCards === 0 && performance.yellowCards < 5) return;
  const rng = stream(state.seed, 'ban', player.id, performance.clubId, performance.redCards);
  const matches = performance.redCards > 0 ? rng.int(1, 3) : 1;
  const until = nextMatchDate ? addDays(nextMatchDate, (matches - 1) * 7) : null;
  player.availability = {
    status: 'unavailable',
    reason: 'suspension',
    note: `${matches} match ban`,
    until,
    discoveredLate: false,
  };
  events.push(
    createEvent(state, {
      type: 'player-unavailable',
      importance: 2,
      clubIds: player.clubId ? [player.clubId] : [],
      personIds: [player.id],
      data: {
        player: `${player.firstName} ${player.surname}`,
        club: state.clubs[player.clubId ?? '']?.identity.name ?? 'the club',
        note: `suspended for ${matches} match${matches > 1 ? 'es' : ''}`,
      },
    }),
  );
}

function resultForClub(match: Match, clubId: ClubId): 'win' | 'draw' | 'loss' {
  const result = match.result!;
  const isHome = match.homeClubId === clubId;
  const own = isHome ? result.homeGoals : result.awayGoals;
  const other = isHome ? result.awayGoals : result.homeGoals;
  if (own > other) return 'win';
  if (own === other) return 'draw';
  return 'loss';
}

export interface ConsequenceResult {
  events: GameEvent[];
  performanceReview: Array<{ playerId: PlayerId; rating: number; goals: number; assists: number }>;
}

export function applyMatchConsequences(state: GameState, match: Match): ConsequenceResult {
  const events: GameEvent[] = [];
  const review: ConsequenceResult['performanceReview'] = [];
  if (!match.result) return { events, performanceReview: review };

  // The social side of a matchday is settled first, so a bust-up or a quiet
  // word affects how the week feels rather than being bolted on afterwards.
  events.push(...applyMatchRelationshipEffects(state, match));

  const seasonLabel = state.season.label;
  const nextMatchDate = nextMatchDateFor(state, match);
  // A friendly counts for legs and lungs, never for the record books: nobody
  // wants a pre-season hat-trick sitting in their career totals.
  const competitive = isCompetitiveMatch(state, match);

  for (const performance of Object.values(match.performances)) {
    const person = state.people[performance.playerId];
    if (!isPlayer(person)) continue;
    const player = person;

    if (competitive) {
      if (performance.started) player.record.appearances += 1;
      else if (performance.cameOnMinute !== null) player.record.substituteAppearances += 1;
      player.record.goals += performance.goals;
      player.record.assists += performance.assists;
      player.record.yellowCards += performance.yellowCards;
      player.record.redCards += performance.redCards;
    }

    if (competitive) {
      const entry = seasonEntryFor(player, seasonLabel, performance.clubId);
      if (performance.started) entry.appearances += 1;
      else if (performance.cameOnMinute !== null) entry.substituteAppearances += 1;
      entry.goals += performance.goals;
      entry.assists += performance.assists;
      entry.yellowCards += performance.yellowCards;
      entry.redCards += performance.redCards;
    }

    applyCondition(player, performance);
    applyMorale(state, player, performance, resultForClub(match, performance.clubId));
    applyInjury(player, performance, match.date, events, state);
    applySuspension(player, performance, nextMatchDate, events, state);

    review.push({ playerId: player.id, rating: performance.rating, goals: performance.goals, assists: performance.assists });

    // Milestones: the sort of thing that gets mentioned on the group chat.
    const seasonGoals = player.record.seasons.reduce((sum, s) => sum + s.goals, 0);
    if (performance.goals > 0 && seasonGoals >= 10 && seasonGoals % 10 === 0) {
      events.push(
        createEvent(state, {
          type: 'goal-milestone',
          importance: 2,
          clubIds: [performance.clubId],
          personIds: [player.id],
          data: {
            player: `${player.firstName} ${player.surname}`,
            club: state.clubs[performance.clubId]?.identity.shortName ?? 'the club',
            goals: seasonGoals,
          },
        }),
      );
    }
    if (player.record.appearances > 0 && player.record.appearances % 25 === 0 && performance.started) {
      events.push(
        createEvent(state, {
          type: 'appearance-milestone',
          importance: 1,
          clubIds: [performance.clubId],
          personIds: [player.id],
          data: {
            player: `${player.firstName} ${player.surname}`,
            club: state.clubs[performance.clubId]?.identity.shortName ?? 'the club',
            appearances: player.record.appearances,
          },
        }),
      );
    }
  }

  recordMatchHistory(state, match, events);
  return { events, performanceReview: review };
}

/**
 * What a matchday does to relationships.
 *
 * Most weeks, nothing much: a side that plays badly does not automatically fall
 * out with itself. The system only reacts when something socially significant
 * actually happened — somebody was left out entirely while fit, somebody was
 * praised, two lads had a row after a red card.
 */
function applyMatchRelationshipEffects(state: GameState, match: Match): GameEvent[] {
  const events: GameEvent[] = [];
  const result = match.result;
  if (!result) return events;

  for (const side of ['home', 'away'] as const) {
    const lineup = match.lineups[side];
    const club = state.clubs[lineup.clubId];
    if (!club) continue;
    const managerId = club.managerId;
    if (!managerId) continue;
    const opponentId = match.homeClubId === club.id ? match.awayClubId : match.homeClubId;
    const opponent = state.clubs[opponentId]?.identity.shortName ?? 'the opposition';
    const outcome = resultForClub(match, club.id);
    const newsWorthy = club.id === state.userClubId;
    const selectedIds = new Set<PlayerId>([
      ...lineup.starting.map((slot) => slot.playerId),
      ...lineup.bench.map((slot) => slot.playerId),
    ]);

    const report = (outcome: RelationshipEventResult | null, publish = true): void => {
      if (!outcome || !newsWorthy || !publish) return;
      events.push(
        createEvent(state, {
          type: 'dressing-room',
          importance: outcome.importance,
          clubIds: [club.id],
          personIds: [outcome.relationship.personAId, outcome.relationship.personBId],
          data: {
            headline: outcome.headline,
            body: `${outcome.description}.`,
          },
        }),
      );
    };

    // Winning together is the cheapest way to make two people closer.
    if (outcome === 'win' && lineup.starting.length >= 2) {
      const rng = stream(state.seed, 'rel-shared', match.id, club.id);
      if (rng.chance(0.5)) {
        const starters = lineup.starting.map((slot) => slot.playerId);
        const a = rng.pick(starters);
        const b = rng.pick(starters.filter((id) => id !== a));
        if (b) {
          report(
            applyRelationshipEvent(state, {
              type: 'shared-success',
              aId: a,
              bId: b,
              intensity: 0.8,
              date: match.date,
              clubId: club.id,
              detail: `the win over ${opponent}`,
            }),
          );
        }
      }
    }

    // Being fit, available and left out of the whole matchday squad is the thing
    // that actually sours a player against a manager. Rotating a player onto the
    // bench is not: he is still involved, and most weeks he shrugs it off.
    for (const playerId of club.squadIds) {
      const person = state.people[playerId];
      if (!isPlayer(person) || person.id === managerId) continue;
      if (person.availability.status !== 'available') continue;
      if (selectedIds.has(playerId)) continue;
      const ambition = person.attributes.behavioural.ambition / 20;
      const rng = stream(state.seed, 'rel-dropped', match.id, playerId);
      if (!rng.chance(0.22 + ambition * 0.3)) continue;
      // Somebody who thought he had a game sulks loudly; a fringe player just
      // gets on with it, and the dressing room barely notices.
      const prior = getRelationship(state, playerId, managerId);
      const previousTrust = prior ? (prior.personAId === playerId ? prior.aToB.trust : prior.bToA.trust) : 50;
      const outcome = applyRelationshipEvent(state, {
        type: 'dropped',
        aId: playerId,
        bId: managerId,
        intensity: 0.6 + ambition * 0.9,
        date: match.date,
        clubId: club.id,
        detail: `against ${opponent}`,
      });
      report(outcome, previousTrust >= 52);
    }

    // A big individual game after being backed is worth a quiet word of credit.
    for (const performance of Object.values(match.performances)) {
      if (performance.clubId !== club.id || performance.playerId === managerId) continue;
      if (!(performance.goals > 0 || performance.rating >= 7.4)) continue;
      const rng = stream(state.seed, 'rel-praise', match.id, performance.playerId);
      if (!rng.chance(performance.goals > 0 ? 0.55 : 0.3)) continue;
      report(
        applyRelationshipEvent(state, {
          type: 'manager-praise',
          aId: performance.playerId,
          bId: managerId,
          intensity: performance.goals > 0 ? 1 : 0.6,
          date: match.date,
          clubId: club.id,
          detail:
            performance.goals > 0
              ? `${performance.goals} goal${performance.goals > 1 ? 's' : ''} against ${opponent}`
              : `a ${performance.rating.toFixed(1)} out of 10 against ${opponent}`,
        }),
      );
    }

    // A sending off is the classic way for a dressing room to fall out with
    // itself — and not with the manager, with the bloke who went through him.
    for (const performance of Object.values(match.performances)) {
      if (performance.clubId !== club.id || !performance.sentOff) continue;
      const rng = stream(state.seed, 'rel-row', match.id, performance.playerId);
      if (!rng.chance(0.5)) continue;
      const teammates = club.squadIds.filter(
        (id) => id !== performance.playerId && isPlayer(state.people[id]),
      );
      if (teammates.length === 0) continue;
      const target = rng.pick(teammates);
      report(
        applyRelationshipEvent(state, {
          type: 'teammate-argument',
          aId: performance.playerId,
          bId: target,
          intensity: 1,
          date: match.date,
          clubId: club.id,
          detail: `after the red card against ${opponent}`,
        }),
      );
    }
  }

  return events;
}

function nextMatchDateFor(state: GameState, match: Match): ISODate | null {
  const next = state.season.calendar.find((entry) => entry.matchday === match.matchday + 1);
  return next ? next.date : null;
}

function recordMatchHistory(state: GameState, match: Match, events: GameEvent[]): void {
  const home = state.clubs[match.homeClubId];
  const away = state.clubs[match.awayClubId];
  const result = match.result;
  if (!home || !away || !result) return;
  // Friendlies leave the season's figures alone: no wins, no goals for, no
  // "beat them 5-0" written into a club's history off the back of a warm-up.
  if (!isCompetitiveMatch(state, match)) return;

  const scoreLine = `${result.homeGoals}-${result.awayGoals}`;
  const margin = Math.abs(result.homeGoals - result.awayGoals);
  const winner = result.homeGoals === result.awayGoals ? null : result.homeGoals > result.awayGoals ? home : away;
  const loser = winner ? (winner.id === home.id ? away : home) : null;

  if (margin >= 5 && winner) {
    winner.history.notableEvents.unshift({
      date: match.date,
      seasonLabel: state.season.label,
      description: `Beat ${loser!.identity.name} ${scoreLine} in ${match.competitionName}.`,
      importance: 2,
    });
    events.push(
      createEvent(state, {
        type: 'notable-result',
        importance: 2,
        clubIds: [winner.id, loser!.id],
        matchId: match.id,
        data: {
          winner: winner.identity.shortName,
          loser: loser!.identity.shortName,
          score: scoreLine,
          note: `A heavy defeat for ${loser!.identity.name} — the sort of scoreline that gets checked twice.`,
        },
      }),
    );
  }

  for (const club of [home, away]) {
    const record = club.history.seasons.find((season) => season.seasonId === state.season.id);
    const won = resultForClub(match, club.id) === 'win';
    const drew = resultForClub(match, club.id) === 'draw';
    if (record) {
      record.played += 1;
      if (won) record.won += 1;
      else if (drew) record.drawn += 1;
      else record.lost += 1;
      record.goalsFor += club.id === match.homeClubId ? result.homeGoals : result.awayGoals;
      record.goalsAgainst += club.id === match.homeClubId ? result.awayGoals : result.homeGoals;
      record.points = record.won * 3 + record.drawn;
    }
  }

  // Keep notable events manageable.
  for (const club of [home, away]) {
    if (club.history.notableEvents.length > 40) club.history.notableEvents.length = 40;
  }
}

/** Match report event for a finished fixture, used by the news service. */
export function matchReportEvent(state: GameState, match: Match, importance: 1 | 2 | 3 = 2): GameEvent {
  const home = state.clubs[match.homeClubId];
  const away = state.clubs[match.awayClubId];
  const result = match.result!;
  const scorers = Object.values(match.performances)
    .filter((performance) => performance.goals > 0)
    .sort((a, b) => b.goals - a.goals)
    .map((performance) => {
      const person = state.people[performance.playerId];
      const name = person ? `${person.firstName.charAt(0)}. ${person.surname}` : 'Unknown';
      return performance.goals > 1 ? `${name} (${performance.goals})` : name;
    })
    .join(', ');

  const ground = state.world.grounds[match.groundId];
  const margin = Math.abs(result.homeGoals - result.awayGoals);
  const userInvolved = match.homeClubId === state.userClubId || match.awayClubId === state.userClubId;
  const verdict = userInvolved
    ? result.homeGoals === result.awayGoals
      ? 'Two points dropped, or a point gained — depends who you ask.'
      : 'The dressing room will have plenty to say about that one.'
    : margin >= 4
      ? 'A one-sided affair by the end.'
      : 'A tight game between two local sides.';

  return createEvent(state, {
    type: 'match-result',
    importance: userInvolved ? 3 : importance,
    clubIds: [match.homeClubId, match.awayClubId],
    matchId: match.id,
    data: {
      homeClub: home?.identity.name ?? 'Home',
      awayClub: away?.identity.name ?? 'Away',
      homeGoals: result.homeGoals,
      awayGoals: result.awayGoals,
      venue: `${ground?.name ?? 'Unknown'} · ${formatShortDate(match.date)}`,
      attendance: result.attendance,
      scorers,
      verdict,
    },
  });
}

const MOODS_BY_MARGIN = ['held on', 'battled through'];

export function describeResult(state: GameState, match: Match, clubId: ClubId): string {
  if (!match.result) return 'Not played yet.';
  const outcome = resultForClub(match, clubId);
  const opponentId = match.homeClubId === clubId ? match.awayClubId : match.homeClubId;
  const opponent = state.clubs[opponentId]?.identity.shortName ?? 'the opposition';
  const own = match.homeClubId === clubId ? match.result.homeGoals : match.result.awayGoals;
  const other = match.homeClubId === clubId ? match.result.awayGoals : match.result.homeGoals;
  const margin = Math.abs(own - other);
  if (outcome === 'win') return `Won ${own}-${other} against ${opponent}${margin >= 4 ? ` — ${MOODS_BY_MARGIN[0]}` : ''}.`;
  if (outcome === 'loss') return `Lost ${own}-${other} to ${opponent}.`;
  return `Drew ${own}-${other} with ${opponent}.`;
}
