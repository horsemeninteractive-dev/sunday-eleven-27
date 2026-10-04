import type { ClubId, PlayerId } from '@/domain/ids';
import type { InjuryDetail, Match, MatchEvent, PlayerPerformance } from '@/domain/match';
import type { Player } from '@/domain/person';
import type { PositionCode } from '@/domain/positions';
import { stream, type Rng } from '../rng';
import * as C from './commentary';
import {
  attackingCoordinates,
  buildContext,
  currentScore,
  displayMinute,
  halfEndMinute,
  makeEvent,
  otherSide,
  performanceOf,
  pushEvent,
  sideClubId,
  SIDES,
  textContext,
  type MatchContext,
  type MatchEnvironment,
  type MinuteResult,
  type Side,
} from './core';
import { buildMinuteCommentary, makeCommentaryLine, recordCommentary, splitCommentaryByChain } from './passages';
import { runMinuteFootball } from './possession';
import {
  ensureSpatial,
  flushUntoldCommentary,
  installPossessionChains,
  installRestart,
  planMinutePassage,
} from './spatial';
import { beginKickoff } from './restarts';
import { defaultRoleFor } from './roles';
import { conditionEffects } from './tacticsModel';
import { positionRoleWeights } from './teamStrength';

/**
 * The match engine advances one minute at a time from a serialisable state.
 *
 * What it no longer does is invent the football. The minute used to be a handful
 * of independent rolls — does this side have the ball, does it shoot, does it
 * give it away, does anybody get booked — which produced plausible incidents that
 * were not connected to one another. The football now comes from
 * {@link runMinuteFootball}: a run of possessions, each a sequence of decisions
 * made by named players against defenders trying to stop them. A shot exists
 * because somebody got the ball somewhere worth shooting from; a foul exists
 * because a challenge failed; a corner exists because a shot was blocked.
 *
 * What stays here is everything that is about the *match* rather than the ball:
 * the whistle, the clock, fatigue, injuries, the bench, the ratings, and the
 * narration. Those are unchanged, deliberately — the overhaul is of the
 * simulation, not of the game around it.
 *
 * Randomness is drawn from `(match.seed, half, minute)` streams rather than a
 * mutable generator, so a fixture replays identically from any starting point,
 * and any mid-match decision (a substitution, a tactical switch) genuinely
 * changes what happens from that minute onward.
 */

export { SIDES, otherSide, sideClubId, halfEndMinute, displayMinute, currentScore, performanceOf, attackingCoordinates };
export type { Side, MatchEnvironment, MinuteResult, MatchContext };

const BASE_INJURY_RATE = 0.00055;

/** True when nobody is ahead. The one question extra time is asked. */
function isLevel(match: Match): boolean {
  const score = currentScore(match);
  return score.home === score.away;
}

function newPerformance(
  playerId: PlayerId,
  player: Player | undefined,
  clubId: ClubId,
  position: PositionCode,
  started: boolean,
  cameOnMinute: number | null,
): PlayerPerformance {
  return {
    playerId,
    clubId,
    started,
    minutesPlayed: 0,
    positionPlayed: position,
    goals: 0,
    assists: 0,
    shots: 0,
    shotsOnTarget: 0,
    passes: 0,
    passesCompleted: 0,
    tackles: 0,
    interceptions: 0,
    saves: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    rating: 6,
    cameOnMinute,
    wentOffMinute: null,
    energy: player?.fitness ?? 100,
    injuryDetail: null,
    sentOff: false,
  };
}

export function beginMatch(match: Match, env: MatchEnvironment): void {
  if (match.status !== 'scheduled') return;

  for (const side of SIDES) {
    const lineup = match.lineups[side];
    const clubId = sideClubId(match, side);
    for (const slot of lineup.starting) {
      match.performances[slot.playerId] = newPerformance(slot.playerId, env.getPlayer(slot.playerId), clubId, slot.position, true, null);
    }
    for (const bench of lineup.bench) {
      match.performances[bench.playerId] = newPerformance(bench.playerId, env.getPlayer(bench.playerId), clubId, bench.position, false, null);
    }
  }

  match.status = 'in-progress';
  match.half = 1;
  match.minute = 0;
  match.footballSeconds = 0;
  match.footballCarryoverSeconds = 0;
  match.possessionTicks = { home: 0, away: 0 };
  match.substitutions = { home: 0, away: 0 };
  // A fresh kick-off starts with a fresh picture of the football, whatever an
  // earlier run of this fixture left behind.
  delete match.field;

  const rng = stream(match.seed, 'prematch');
  match.incidents = [];
  if (rng.chance(0.35)) {
    const incident = rng.pick(C.INCIDENT_POOL);
    match.incidents.push(incident(env.clubName(match.homeClubId), env.clubName(match.awayClubId)));
  }

  const events: MatchEvent[] = [];
  pushEvent(
    match,
    makeEvent(match, 'note', {
      minute: 0,
      side: null,
      text: C.writeWeatherNote(match.conditions.weather, match.conditions.pitch, rng.float(3, 25)),
      x: 0.5,
      y: 0.5,
      importance: 1,
    }),
    events,
  );
  for (const incident of match.incidents) {
    pushEvent(match, makeEvent(match, 'note', { minute: 0, side: null, text: incident, x: 0.5, y: 0.5, importance: 1 }), events);
  }
  pushEvent(
    match,
    makeEvent(match, 'kick-off', {
      minute: 0,
      side: 'home',
      text: C.writeKickOff(env.clubName(match.homeClubId), env.clubName(match.awayClubId), match.conditions.pitch),
      x: 0.5,
      y: 0.5,
      importance: 1,
    }),
    events,
  );

  if (env.recordCommentary) {
    recordCommentary(
      match,
      events.map((event) =>
        makeCommentaryLine(match, {
          minute: 0,
          side: event.clubId === match.homeClubId ? 'home' : event.clubId === match.awayClubId ? 'away' : null,
          category: 'period',
          priority: event.type === 'kick-off' ? 'contextual' : 'routine',
          kind: event.type === 'kick-off' ? 'Kick-off' : null,
          text: event.text,
        }),
      ),
    );
    // A match somebody is watching also gets a pitch to happen on. Other
    // clubs' fixtures are played out a minute at a time and never need one.
    const spatial = ensureSpatial(match, env);
    const kickOff = spatial.players.find((node) => node.side === 'home' && (node.position === 'CM' || node.position === 'ST')) ?? spatial.players[0];
    // The whistle goes and the ball is *put down on the centre spot* before it is
    // in anybody's feet. It used to be handed straight to a midfielder, so there
    // was no frame of the match at which the ball was lying loose on the halfway
    // line — the game began in the middle of a possession nobody saw begin.
    // Three seconds of setup, the two forwards to the circle, and then it is in
    // play.
    if (kickOff) installRestart(match, beginKickoff('home', kickOff.playerId, undefined, undefined));
  }
}

function onPitchIds(match: Match, side: Side): PlayerId[] {
  return match.lineups[side].starting.map((slot) => slot.playerId);
}

function applyFatigue(match: Match, env: MatchEnvironment, context: MatchContext): void {
  for (const side of SIDES) {
    const profile = context[side].profile;
    for (const slot of match.lineups[side].starting) {
      const player = env.getPlayer(slot.playerId);
      const performance = performanceOf(match, slot.playerId);
      if (!player || !performance) continue;
      const staminaFactor = 0.5 + player.attributes.physical.stamina / 20;
      const baseDrain = slot.position === 'GK' ? 0.35 : 0.95;
      const injuryPenalty = performance.injuryDetail ? 1.2 : 1;
      performance.energy = Math.max(0, performance.energy - (baseDrain / staminaFactor) * profile.fatigueRate * injuryPenalty);
      performance.minutesPlayed += 1;
    }
  }
}

/**
 * Most Sunday League injuries are knocks and strains. Serious ones are rare
 * enough to be genuinely memorable; a bad pitch and a tired body raise the
 * odds of the middle categories, not of a broken leg.
 */
function pickInjury(rng: Rng, player: Player, energy: number, injuryRate: number): InjuryDetail {
  const susceptibility = player.attributes.hidden.injurySusceptibility;
  const tiredness = 1 + (100 - energy) / 140;
  const seriousChance = 0.022 * injuryRate * (0.6 + susceptibility / 20);
  const moderateChance = 0.1 * injuryRate * tiredness;
  const minorChance = 0.28 * tiredness;

  const roll = rng.next();
  let severity: InjuryDetail['severity'];
  if (roll < seriousChance) severity = 'serious';
  else if (roll < seriousChance + moderateChance) severity = 'moderate';
  else if (roll < seriousChance + moderateChance + minorChance) severity = 'minor';
  else severity = 'knock';

  const descriptions: Record<InjuryDetail['severity'], string[]> = {
    knock: ['a dead leg', 'a knock on the ankle', 'a bang on the knee', 'a cut above the eye'],
    minor: ['a twisted ankle', 'a tight hamstring', 'a pulled calf', 'bruised ribs', 'a groin strain'],
    moderate: ['a hamstring tear', 'a badly rolled ankle', 'a medial knee strain', 'a shoulder injury'],
    serious: ['a suspected broken leg', 'cruciate ligament damage', 'a dislocated shoulder', 'a fractured collarbone'],
  };
  const daysOut =
    severity === 'knock'
      ? rng.int(0, 3)
      : severity === 'minor'
        ? rng.int(4, 12)
        : severity === 'moderate'
          ? rng.int(14, 38)
          : rng.int(60, 240);

  return { description: rng.pick(descriptions[severity]), severity, daysOut };
}

function makeSubstitution(match: Match, env: MatchEnvironment, side: Side, outgoingId: PlayerId, sink: MatchEvent[]): boolean {
  const lineup = match.lineups[side];
  if (lineup.bench.length === 0) return false;
  if (match.substitutions[side] >= env.substitutionsAllowed) return false;

  const slotIndex = lineup.starting.findIndex((slot) => slot.playerId === outgoingId);
  if (slotIndex < 0) return false;
  const slot = lineup.starting[slotIndex]!;
  const outgoing = env.getPlayer(outgoingId);

  const candidates = lineup.bench
    .map((bench, index) => {
      const player = env.getPlayer(bench.playerId);
      if (!player) return { index, player: null, score: -1 };
      const familiarity = player.positionalFamiliarity[slot.position] ?? 0;
      const suitability = familiarity / 20 + (player.preferredPosition === slot.position ? 1 : 0);
      return { index, player, score: suitability * 2 + player.fitness / 100 };
    })
    .sort((a, b) => b.score - a.score);

  const chosen = candidates[0];
  if (!chosen || !chosen.player) return false;
  const incoming = chosen.player;

  const performance = performanceOf(match, outgoingId);
  if (performance) performance.wentOffMinute = match.minute;

  lineup.bench.splice(chosen.index, 1);
  lineup.starting[slotIndex] = {
    playerId: incoming.id,
    position: slot.position,
    // A substitute takes the job of the slot he comes into, not his own.
    role: defaultRoleFor(slot.position),
    outOfPosition: (incoming.positionalFamiliarity[slot.position] ?? 0) < 12,
  };
  match.performances[incoming.id] = newPerformance(incoming.id, incoming, sideClubId(match, side), slot.position, false, match.minute);
  match.substitutions[side] += 1;

  pushEvent(
    match,
    makeEvent(match, 'substitution', {
      minute: match.minute,
      side,
      playerId: incoming.id,
      secondaryPlayerId: outgoingId,
      text: C.writeSubstitution(
        `${incoming.firstName.charAt(0)}. ${incoming.surname}`,
        outgoing ? `${outgoing.firstName.charAt(0)}. ${outgoing.surname}` : 'a teammate',
        env.clubName(sideClubId(match, side)),
      ),
      x: 0.5,
      y: 0.5,
      importance: 2,
    }),
    sink,
  );
  return true;
}

/** Bench management: injuries first, then tired legs late on. */
function manageBench(match: Match, env: MatchEnvironment, side: Side, rng: Rng, sink: MatchEvent[]): void {
  if (env.userClubId === sideClubId(match, side) && !env.autoManageAllBenches) return;

  const onPitch = onPitchIds(match, side);
  const injured = onPitch.find((id) => performanceOf(match, id)?.injuryDetail);
  if (injured && match.minute > 2 && makeSubstitution(match, env, side, injured, sink)) return;

  if (match.minute < 55) return;
  const tired = onPitch
    .map((id) => ({
      id,
      energy: performanceOf(match, id)?.energy ?? 100,
      position: match.lineups[side].starting.find((slot) => slot.playerId === id)?.position,
    }))
    .filter((entry) => entry.position && entry.position !== 'GK')
    .sort((a, b) => a.energy - b.energy)[0];

  if (!tired || tired.energy > 46) return;
  if (rng.chance(0.16)) makeSubstitution(match, env, side, tired.id, sink);
}

function resolveInjury(
  match: Match,
  env: MatchEnvironment,
  rng: Rng,
  injuryRate: number,
  sink: MatchEvent[],
): void {
  for (const side of SIDES) {
    for (const slot of match.lineups[side].starting) {
      const player = env.getPlayer(slot.playerId);
      const performance = performanceOf(match, slot.playerId);
      if (!player || !performance || performance.injuryDetail) continue;
      const susceptibility = player.attributes.hidden.injurySusceptibility;
      const tiredness = 1 + (100 - performance.energy) / 140;
      const probability = BASE_INJURY_RATE * injuryRate * (0.4 + susceptibility / 12) * tiredness;
      if (!rng.chance(probability)) continue;

      performance.injuryDetail = pickInjury(rng, player, performance.energy, injuryRate);
      pushEvent(
        match,
        makeEvent(match, 'injury', {
          minute: match.minute,
          side,
          playerId: player.id,
          text: C.writeInjury(textContext(env, match, side, rng, { player })),
          ...attackingCoordinates(match, otherSide(side), rng, 'build'),
          importance: 2,
        }),
        sink,
      );
      return; // At most one injury per minute.
    }
  }
}

function computeRating(match: Match, performance: PlayerPerformance): number {
  const score = currentScore(match);
  const isHome = performance.clubId === match.homeClubId;
  const conceded = isHome ? score.away : score.home;
  const scored = isHome ? score.home : score.away;
  const defWeight = defensiveWeight(performance.positionPlayed);

  let rating = 6.1;
  rating += performance.goals * 1.15;
  rating += performance.assists * 0.6;
  rating += performance.shotsOnTarget * 0.05;
  rating += performance.tackles * 0.035;
  rating += performance.interceptions * 0.03;
  rating += performance.saves * 0.12;
  rating += performance.passesCompleted * 0.004;
  rating -= performance.fouls * 0.02;
  rating -= performance.yellowCards * 0.35;
  rating -= performance.redCards * 1.4;
  rating -= conceded * 0.1 * defWeight * (performance.positionPlayed === 'GK' ? 1.4 : 1);
  if (conceded === 0) rating += 0.25 * (performance.positionPlayed === 'GK' ? 1.2 : defWeight);
  rating += scored > conceded ? 0.3 : scored === conceded ? 0.1 : -0.2;
  if (performance.minutesPlayed < 20) rating = 6 + (rating - 6) * 0.6;
  if (performance.injuryDetail) rating -= 0.1;

  return Math.max(3, Math.min(10, Math.round(rating * 10) / 10));
}

function defensiveWeight(position: PositionCode): number {
  const def = positionRoleWeights(position).def;
  return def >= 0.7 ? 1 : def >= 0.4 ? 0.6 : 0.25;
}

function attendanceFrom(env: MatchEnvironment, match: Match): number {
  const rng = stream(match.seed, 'attendance');
  return Math.max(10, Math.round(env.expectedAttendance * (1 + rng.float(-0.12, 0.15))));
}

/**
 * A penalty shootout, for a cup tie nobody could separate.
 *
 * This is deliberately *outside* the minute loop. Extra time is football and is
 * played through `advanceMinute` like any other period; a shootout is not
 * football at all, it is a series of independent rolls decided by a stream of
 * its own (`match.seed`, `'shootout'`, kick). Nothing in the possession model,
 * the tactics model or the spatial layer can reach it, and a league match can
 * never arrive here — the only caller is `finishMatch`, and only for a match
 * with `knockout` set and the scores level after 120 minutes.
 */
function resolveShootout(match: Match, env: MatchEnvironment): { home: number; away: number } {
  const takers = (side: Side): PlayerId[] =>
    match.lineups[side].starting
      .map((slot) => slot.playerId)
      .filter((id) => !match.performances[id]?.sentOff);

  /** Take the kick. Composure does most of the work, technique a little. */
  const take = (playerId: PlayerId | undefined, kick: number): boolean => {
    const player = playerId ? env.getPlayer(playerId) : undefined;
    const rng = stream(match.seed, 'shootout', kick);
    const composure = player ? player.attributes.mental.composure : 10;
    const technique = player ? player.attributes.technical.shooting : 10;
    return rng.chance(Math.max(0.45, Math.min(0.92, 0.68 + (composure - 11) / 90 + (technique - 11) / 180)));
  };

  const homeTakers = takers('home');
  const awayTakers = takers('away');
  const at = (list: PlayerId[], round: number): PlayerId | undefined =>
    list.length === 0 ? undefined : list[Math.min(round, list.length - 1)];

  let home = 0;
  let away = 0;
  let kick = 0;
  let winnerId: ClubId = match.homeClubId;

  // Five kicks each, then sudden death. After both sides have taken the same
  // number, a lead settles it — which is the rule, and is also why the last
  // kick of a tied shootout is worth watching.
  const REGULATION_KICKS = 5;
  const MAX_ROUNDS = 12;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (take(at(homeTakers, round), kick)) home += 1;
    kick += 1;
    if (take(at(awayTakers, round), kick)) away += 1;
    kick += 1;

    if (round >= REGULATION_KICKS - 1 && home !== away) {
      winnerId = home > away ? match.homeClubId : match.awayClubId;
      break;
    }
    // A side cannot win the shootout while it is still level, and after five
    // kicks each the only way out is sudden death, so the loop runs on.
  }

  if (home === away) {
    // Unreachable with a real shootout — sudden death always breaks it — but a
    // career must never end with an undecided tie, so the home side takes it.
    winnerId = match.homeClubId;
  }

  match.shootoutWinnerId = winnerId;
  return { home, away };
}

function finishMatch(match: Match, env: MatchEnvironment, sink: MatchEvent[]): void {
  match.status = 'finished';
  match.played = true;
  // Whatever was decided in the last minute or two but never reached the pitch
  // still gets said. The final whistle is not a reason for the match to lose
  // the last lines of its own commentary.
  flushUntoldCommentary(match);
  const score = currentScore(match);

  // A cup tie nobody separated goes to penalties, decided here and written into
  // the result, so the record a season is read from is the one that actually
  // settled the tie. A league match is level and `knockout` is absent, so it
  // can never take this path.
  const penalties = match.knockout && score.home === score.away ? resolveShootout(match, env) : null;
  if (penalties) {
    pushEvent(
      match,
      makeEvent(match, 'penalties', {
        minute: match.minute,
        side: null,
        text: `Penalties: ${penalties.home}–${penalties.away}. ${
          match.shootoutWinnerId === match.homeClubId
            ? env.clubName(match.homeClubId)
            : env.clubName(match.awayClubId)
        } go through.`,
        x: 0.5,
        y: 0.5,
        scoreAfter: score,
        importance: 3,
      }),
      sink,
    );
  }

  pushEvent(
    match,
    makeEvent(match, 'full-time', {
      minute: match.minute,
      side: null,
      text: C.writeFullTime(score.home, score.away),
      x: 0.5,
      y: 0.5,
      importance: 3,
    }),
    sink,
  );

  if (env.recordCommentary) {
    recordCommentary(match, [
      makeCommentaryLine(match, {
        minute: match.minute,
        side: null,
        category: 'period',
        priority: 'major',
        kind: 'Full time',
        text: C.writeFullTime(score.home, score.away),
        scoreAfter: score,
      }),
    ]);
  }

  const ticks = match.possessionTicks.home + match.possessionTicks.away;
  const homePossession = ticks === 0 ? 50 : Math.round((match.possessionTicks.home / ticks) * 100);

  match.result = {
    homeGoals: score.home,
    awayGoals: score.away,
    homeShots: sumStat(match, 'home', (performance) => performance.shots),
    awayShots: sumStat(match, 'away', (performance) => performance.shots),
    homePossession,
    awayPossession: 100 - homePossession,
    attendance: attendanceFrom(env, match),
    ...(penalties ? { penalties } : {}),
  };

  for (const performance of Object.values(match.performances)) {
    performance.rating = computeRating(match, performance);
  }
}

/** Sum a per-player figure across a side, read from the performances the engine wrote. */
function sumStat(match: Match, side: Side, pick: (performance: PlayerPerformance) => number): number {
  const clubId = sideClubId(match, side);
  let total = 0;
  for (const performance of Object.values(match.performances)) {
    if (performance.clubId !== clubId) continue;
    total += pick(performance) || 0;
  }
  return total;
}

/**
 * The minute the clock reads, from how much football has actually been played.
 *
 * The minute is a label, so it is worked out rather than counted: a possession
 * that ran from the 12th minute into the 13th takes the clock with it, and an
 * event is filed under the minute the football had genuinely reached. Whole
 * minutes only — the display has never shown a part-minute and nothing should
 * start now — and floored, so the 13th minute is 13:00 to 13:59.
 */
function minuteFor(match: Match): number {
  return Math.floor((match.footballSeconds ?? match.minute * 60) / 60);
}

/**
 * Advance the match by one minute of football.
 *
 * `watched` says whether anybody is watching this one being played. A watched
 * match has a pitch, and its commentary is dealt out to the chains the pitch
 * plays and told as each one starts — the words and the picture being the same
 * moment rather than a minute apart. A match run straight out to the whistle has
 * no picture to keep step with, so its words are simply written down.
 */
export function advanceMinute(match: Match, env: MatchEnvironment, watched = true): MinuteResult {
  const events: MatchEvent[] = [];
  if (match.status === 'finished') return { minute: match.minute, events, halfTime: false, finished: true };
  if (match.status === 'scheduled') beginMatch(match, env);

  // The clock is the label; the football decides how far it has got. The slice
  // asked for is a minute of football time, and the possession model advances
  // the clock by the seconds it actually played; whatever it decided past the
  // minute mark is carried over, so a possession can cross it. The engine does
  // not touch the clock here: advancing it in two places was counting every
  // minute twice and running the label at double speed.
  const startMinute = match.minute;
  const context = buildContext(match, env);
  const rng = stream(match.seed, 'minute', match.half, startMinute);

  if (match.half === 1) {
    if (match.minute >= halfEndMinute(match, 1)) {
      const score = currentScore(match);
      pushEvent(
        match,
        makeEvent(match, 'half-time', {
          minute: match.minute,
          side: null,
          text: C.writeHalfTime(score.home, score.away),
          x: 0.5,
          y: 0.5,
          importance: 3,
        }),
        events,
      );
      if (env.recordCommentary) {
        recordCommentary(match, [
          makeCommentaryLine(match, {
            minute: match.minute,
            side: null,
            category: 'period',
            priority: 'important',
            kind: 'Half time',
            text: C.writeHalfTime(score.home, score.away),
            scoreAfter: score,
          }),
        ]);
      }
      match.half = 2;
      // The second half starts at 45, whatever first-half stoppage took the clock
      // to: the clock is the label, and a half begins when it begins.
      match.minute = 45;
      match.footballSeconds = 45 * 60;
      match.footballCarryoverSeconds = 0;
      return { minute: 45, events, halfTime: true, finished: false };
    }
    match.minute = minuteFor(match);
  } else {
    // Period two's end. Guarded on the period, not just the minute: extra time
    // runs past 90, so a bare minute test would fire again at the end of the
    // extra-time periods and send the match back to the ninetieth minute for
    // ever.
    if (match.half < 3 && match.minute >= halfEndMinute(match, 2)) {
      // Ninety minutes in a cup tie, level: two more periods of it. Only
      // reachable when `knockout` is set, so a league match takes the branch
      // below exactly as it always has.
      if (match.knockout && isLevel(match)) {
        pushEvent(
          match,
          makeEvent(match, 'extra-time', {
            minute: match.minute,
            side: null,
            text: C.writeExtraTime(currentScore(match)),
            x: 0.5,
            y: 0.5,
            importance: 3,
          }),
          events,
        );
        match.half = 3;
        match.minute = 90;
        match.footballSeconds = 90 * 60;
        match.footballCarryoverSeconds = 0;
        return { minute: 90, events, halfTime: false, finished: false };
      }
      finishMatch(match, env, events);
      return { minute: match.minute, events, halfTime: false, finished: true };
    }
    // The end of extra time: fifteen minutes of it, and the tie is settled.
    if (match.half === 3 && match.minute >= halfEndMinute(match, 3)) {
      finishMatch(match, env, events);
      return { minute: match.minute, events, halfTime: false, finished: true };
    }
    match.minute = minuteFor(match);
  }

  const injuryRate = conditionEffects(match.conditions).injuryRate;
  applyFatigue(match, env, context);

  // --- The football ---------------------------------------------------------
  // A minute is a run of possessions: somebody has the ball, at a place on the
  // pitch, and has to do something with it. Shots, fouls, corners, cards and
  // the ball going out all come out of that, rather than being rolled for
  // separately. The side that held the ball longest takes the minute's tick, so
  // the possession figure on the stats panel is a reading of the match rather
  // than a second estimate of it.
  const football = runMinuteFootball(match, env, context, rng, events);
  match.possessionTicks[football.possessionSide] += 1;

  // --- Physicality ----------------------------------------------------------
  resolveInjury(match, env, rng, injuryRate, events);

  // --- Bench ---------------------------------------------------------------
  manageBench(match, env, 'home', rng, events);
  manageBench(match, env, 'away', rng, events);

  if (env.recordCommentary || match.spatial) {
    // The narrator's description of the minute, from a stream of its own, so
    // neither a line of prose nor the shape the words are laid out in can ever
    // move the football. It is built from the possession model's own chains —
    // every one of them, in the order they were played, because a minute is a
    // run of possessions and the words have to keep up with all of them — so a
    // line can no longer describe a pass nobody made. It describes the football;
    // it does not play it.
    const passageRng = stream(match.seed, 'spatial', match.half, match.minute);
    const passage = planMinutePassage(match, env, football.chains, events, passageRng);

    // The minute's words, written once. If there is a pitch to play them on,
    // they are dealt out to the chains below and told as each chain starts;
    // with no pitch — an instant result, or a match being simulated straight
    // through — they are simply recorded, because there is nothing to keep step
    // with.
    let told = false;
    if (env.recordCommentary) {
      const commentaryRng = stream(match.seed, 'commentary', match.half, match.minute);
      const lines = buildMinuteCommentary(match, env, football.passageSide, events, passage, commentaryRng);
      if (watched && match.spatial) {
        installPossessionChains(match, env, football.chains, splitCommentaryByChain(football.chains, lines));
        told = true;
      } else {
        recordCommentary(match, lines);
        told = true;
      }
    }

    if (!told && match.spatial) {
      // The possession model has already decided the minute, chain by chain;
      // this hands those decisions to the continuous state as a queue of plans
      // the pitch executes one after another, a fixed step at a time. The
      // passage is built beside it — but only the narrator reads it.
      //
      // There is nothing to fall back to and nothing to fall back *for*: if no
      // chain names anybody on the pitch, or a goal is still being celebrated,
      // there is simply no move to play this minute, and the pitch waits for the
      // next one. The passage is not a second way to play football.
      installPossessionChains(match, env, football.chains);
    }
  }

  return { minute: match.minute, events, halfTime: false, finished: false };
}

/** Run a match to its conclusion. Used for other clubs' fixtures and "instant". */
export function simulateToCompletion(match: Match, env: MatchEnvironment): void {
  if (match.status === 'scheduled') beginMatch(match, env);
  let guard = 0;
  while (match.status !== 'finished' && guard < 400) {
    // Run out without watching: there is no picture for the words to keep step
    // with, so they are written down as the football is decided.
    advanceMinute(match, env, false);
    guard += 1;
  }
}
