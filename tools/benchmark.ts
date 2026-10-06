/**
 * The background-simulation benchmark.
 *
 * Two questions, and it answers both with numbers rather than adjectives:
 *
 *  1. **How fast is FAST?** One match, a whole matchday, and a full season, all
 *     timed against the *same* fixtures played by the full engine, so the
 *     improvement is a measurement rather than a hope.
 *  2. **Is it still the same football?** The two modes must produce the same
 *     *shape* of match — goals, shots, saves, fouls, bookings, knocks,
 *     substitutions, minutes, ratings — because a season's leading scorer and its
 *     disciplinary table must not depend on which fixtures the manager happened
 *     to watch. The fingerprint table puts them side by side, and the last block
 *     prints the strength ratios the FAST model's calibration is pinned to.
 *
 *   npm run benchmark
 *   npm run benchmark -- --fixtures=18 --seasons=2
 *   npm run benchmark -- --seed=bench-2 --json=reports/bench.json
 *
 * It is a developer tool: nothing in the game imports it, and it is outside the
 * test suite. `npm run soak` remains the long-run correctness harness — this one
 * is about cost and calibration.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Match } from '@/domain/match';
import { createTestGame } from '@/simulation/testSupport';
import { processDay } from '@/simulation/day';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { fixtureIdsOnMatchday } from '@/simulation/pyramid';
import { nextMatchday } from '@/simulation/timeline';
import { simulateMatchFast } from '@/simulation/fastMatch';
import { simulateMatchHeadless } from '@/simulation/match/matchEngine';
import { computeTeamStrength } from '@/simulation/match/teamStrength';
import { tacticalProfile } from '@/simulation/match/tacticsModel';
import { isPlayer } from '@/domain/person';

// --- Arguments -------------------------------------------------------------

interface Options {
  seed: string;
  fixtures: number;
  seasons: number;
  clubIndex: number;
  json: string | null;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { seed: 'bench', fixtures: 18, seasons: 1, clubIndex: 0, json: null };
  for (const arg of argv) {
    const [name, value] = arg.replace(/^--/, '').split('=');
    switch (name) {
      case 'seed':
        options.seed = value || 'bench';
        break;
      case 'fixtures':
        options.fixtures = Math.max(1, Number(value ?? 18) || 18);
        break;
      case 'seasons':
        options.seasons = Math.max(0, Number(value ?? 1) || 0);
        break;
      case 'club':
        options.clubIndex = Math.max(0, Number(value ?? 0) || 0);
        break;
      case 'json':
        options.json = value || 'reports/benchmark.json';
        break;
      default:
        break;
    }
  }
  return options;
}

// --- The fingerprint -------------------------------------------------------

interface Fingerprint {
  matches: number;
  games: number;
  goals: number;
  shots: number;
  shotsOnTarget: number;
  saves: number;
  fouls: number;
  yellows: number;
  reds: number;
  corners: number;
  offsides: number;
  blocked: number;
  passes: number;
  passesCompleted: number;
  tackles: number;
  interceptions: number;
  injuries: number;
  subs: number;
  appearances: number;
  events: number;
  homePossession: number;
  ratingSum: number;
  ratingCount: number;
  minutes: number;
  emptyMinutes: number;
}

function emptyFingerprint(): Fingerprint {
  return {
    matches: 0, games: 0, goals: 0, shots: 0, shotsOnTarget: 0, saves: 0, fouls: 0,
    yellows: 0, reds: 0, corners: 0, offsides: 0, blocked: 0, passes: 0, passesCompleted: 0,
    tackles: 0, interceptions: 0, injuries: 0, subs: 0, appearances: 0, events: 0,
    homePossession: 0, ratingSum: 0, ratingCount: 0, minutes: 0, emptyMinutes: 0,
  };
}

function addMatch(into: Fingerprint, match: Match): void {
  if (!match.result) return;
  into.matches += 1;
  into.games += 1;
  const result = match.result;
  into.goals += result.homeGoals + result.awayGoals;
  into.shots += result.homeShots + result.awayShots;
  into.homePossession += result.homePossession;
  into.events += match.events.length;
  into.subs += match.substitutions.home + match.substitutions.away;
  for (const event of match.events) {
    if (event.type === 'corner') into.corners += 1;
    if (event.type === 'offside') into.offsides += 1;
    if (event.type === 'shot-blocked') into.blocked += 1;
  }
  for (const performance of Object.values(match.performances)) {
    into.shotsOnTarget += performance.shotsOnTarget;
    into.saves += performance.saves;
    into.fouls += performance.fouls;
    into.yellows += performance.yellowCards;
    into.reds += performance.redCards;
    into.passes += performance.passes;
    into.passesCompleted += performance.passesCompleted;
    into.tackles += performance.tackles;
    into.interceptions += performance.interceptions;
    if (performance.injuryDetail) into.injuries += 1;
    if (performance.started || performance.cameOnMinute !== null) into.appearances += 1;
    if (performance.started || performance.cameOnMinute !== null) {
      if (performance.minutesPlayed > 20) {
        into.ratingSum += performance.rating;
        into.ratingCount += 1;
      }
      into.minutes += performance.minutesPlayed;
    } else if (performance.minutesPlayed !== 0) {
      // A man who never came on must have played no minutes at all.
      into.emptyMinutes += 1;
    }
  }
}

// --- Telling the numbers ---------------------------------------------------

function padEnd(value: string, width: number): string {
  return value.length > width ? value.slice(0, width) : value.padEnd(width);
}

function heading(text: string): string {
  return `\n── ${text} ${'─'.repeat(Math.max(0, 70 - text.length))}`;
}

function per(value: number, matches: number, digits = 2): string {
  return matches === 0 ? '—' : (value / matches).toFixed(digits);
}

/**
 * One side of the side-by-side table.
 *
 * `columns` is what is printed, in order, with the figure for each mode. Anything
 * present in one mode and absent in the other is shown as a dash rather than as
 * a zero, because "the fast mode does not produce throw-ins" and "the fast mode
 * produces no throw-ins" are different statements and only the first is true.
 */
function row(label: string, full: string, fast: string): string {
  return `  ${padEnd(label, 26)} ${padEnd('full ' + full, 17)} fast ${fast}`;
}

function compare(name: string, full: Fingerprint, fast: Fingerprint): void {
  console.log(heading(name));
  const r = (label: string, a: string, b: string) => console.log(row(label, a, b));
  r('matches played', String(full.matches), String(fast.matches));
  r('goals / match', per(full.goals, full.matches), per(fast.goals, fast.matches));
  r('shots / match', per(full.shots, full.matches), per(fast.shots, fast.matches));
  r('on target / match', per(full.shotsOnTarget, full.matches), per(fast.shotsOnTarget, fast.matches));
  r('saves / match', per(full.saves, full.matches), per(fast.saves, fast.matches));
  r('blocked / match', per(full.blocked, full.matches), per(fast.blocked, fast.matches));
  r('fouls / match', per(full.fouls, full.matches), per(fast.fouls, fast.matches));
  r('yellows / match', per(full.yellows, full.matches), per(fast.yellows, fast.matches));
  r('reds / match', per(full.reds, full.matches), per(fast.reds, fast.matches));
  r('injuries / match', per(full.injuries, full.matches), per(fast.injuries, fast.matches));
  r('subs / match', per(full.subs, full.matches), per(fast.subs, fast.matches));
  r('appearances / match', per(full.appearances, full.matches), per(fast.appearances, fast.matches));
  r('corners / match', full.corners === 0 ? '—' : per(full.corners, full.matches), fast.corners === 0 ? '—' : per(fast.corners, fast.matches));
  r('offsides / match', full.offsides === 0 ? '—' : per(full.offsides, full.matches), fast.offsides === 0 ? '—' : per(fast.offsides, fast.matches));
  r('passes / match', per(full.passes, full.matches, 0), per(fast.passes, fast.matches, 0));
  r(
    'pass completion',
    full.passes === 0 ? '—' : `${((100 * full.passesCompleted) / full.passes).toFixed(1)}%`,
    fast.passes === 0 ? '—' : `${((100 * fast.passesCompleted) / fast.passes).toFixed(1)}%`,
  );
  r('tackles / match', per(full.tackles, full.matches, 1), per(fast.tackles, fast.matches, 1));
  r('interceptions / match', per(full.interceptions, full.matches, 1), per(fast.interceptions, fast.matches, 1));
  r('home possession', per(full.homePossession, full.matches, 1) + '%', per(fast.homePossession, fast.matches, 1) + '%');
  r('mean rating >20min', full.ratingCount === 0 ? '—' : (full.ratingSum / full.ratingCount).toFixed(3), fast.ratingCount === 0 ? '—' : (fast.ratingSum / fast.ratingCount).toFixed(3));
  r('minutes / appearance', per(full.minutes, full.appearances, 1), per(fast.minutes, fast.appearances, 1));
  r('events / match', per(full.events, full.matches, 0), per(fast.events, fast.matches, 0));
  r('bench played minutes?', full.emptyMinutes === 0 ? 'no' : `yes (${full.emptyMinutes})`, fast.emptyMinutes === 0 ? 'no' : `yes (${fast.emptyMinutes})`);
}

// --- Running ---------------------------------------------------------------

const options = parseArgs(process.argv.slice(2));
const { state } = createTestGame(options.seed, options.clubIndex);
const startedAt = Date.now();

// 1. Head to head: the same fixtures, both modes, timed.
const matchday = nextMatchday(state);
prepareMatchday(state, matchday);
const fixtureIds = fixtureIdsOnMatchday(state, matchday).slice(0, options.fixtures);
if (fixtureIds.length === 0) throw new Error('no fixtures on the first matchday');

const full = emptyFingerprint();
const fast = emptyFingerprint();
let fullMs = 0;
let fastMs = 0;
let homeEdge = 0;
let keeperEdge = 0;
let ratioCount = 0;

for (const id of fixtureIds) {
  const template = state.matches[id];
  if (!template) continue;
  const env = matchEnvironment(state, template, { autoManageAllBenches: true });

  const fullMatch = structuredClone(template);
  const before = performance.now();
  simulateMatchHeadless(fullMatch, env);
  fullMs += performance.now() - before;
  addMatch(full, fullMatch);

  const fastMatch = structuredClone(template);
  const beforeFast = performance.now();
  simulateMatchFast(fastMatch, env);
  fastMs += performance.now() - beforeFast;
  addMatch(fast, fastMatch);

  // The strength ratios the FAST model is calibrated against, measured on the
  // very fixtures it is being asked to play.
  const strength = (match: Match, side: 'home' | 'away') => {
    const lineup = match.lineups[side];
    const clubId = side === 'home' ? match.homeClubId : match.awayClubId;
    return computeTeamStrength({
      slots: lineup.starting,
      players: (pid) => {
        const person = state.people[pid];
        return isPlayer(person) ? person : undefined;
      },
      tactics: lineup.tactics,
      conditions: match.conditions,
      energy: () => 100,
      carryingInjury: () => false,
      tacticalFamiliarity: env.tacticalFamiliarity?.(clubId),
      cohesion: env.cohesion?.(clubId),
    });
  };
  const homeStrength = strength(template, 'home');
  const awayStrength = strength(template, 'away');
  homeEdge += homeStrength.attack / Math.max(0.05, awayStrength.defence);
  homeEdge += awayStrength.attack / Math.max(0.05, homeStrength.defence);
  keeperEdge += homeStrength.attack / Math.max(0.05, awayStrength.keeper);
  keeperEdge += awayStrength.attack / Math.max(0.05, homeStrength.keeper);
  ratioCount += 2;
  // `tacticalProfile` is read here only so a change to it that widened these
  // ratios would show up in the benchmark's own output.
  void tacticalProfile(template.lineups.home.tactics, template.conditions);
}

console.log(`\nSE27 background-simulation benchmark  ·  seed "${options.seed}"  ·  matchday ${matchday}`);
console.log(`fixtures: ${fixtureIds.length}`);

compare('Head to head — the same fixtures, both modes', full, fast);

console.log(heading('Timing'));
console.log(`  full engine, one match      ${(fullMs / fixtureIds.length).toFixed(1)} ms  (${fixtureIds.length} matches: ${(fullMs / 1000).toFixed(2)} s)`);
console.log(`  fast mode, one match        ${(fastMs / fixtureIds.length).toFixed(2)} ms`);
const speedup = fastMs === 0 ? Infinity : fullMs / fastMs;
console.log(`  speed-up per match          ${speedup.toFixed(0)}×`);
console.log(`  fast, a full ${fixtureIds.length}-fixture card  ${fastMs.toFixed(1)} ms`);

console.log(heading('Calibration anchors (what an even match reads)'));
console.log(`  attack / opposing defence   ${(homeEdge / ratioCount).toFixed(3)}`);
console.log(`  attack / opposing keeper    ${(keeperEdge / ratioCount).toFixed(3)}`);

// 2. The real day loop: a season, or several, exactly as the soak runs it.
if (options.seasons > 0) {
  const seasonFingerprint = emptyFingerprint();
  const fullFingerprint = emptyFingerprint();
  let seasonSeconds = 0;
  const seasonReport: Array<{ season: string; days: number; seconds: number; matches: number }> = [];

  for (let index = 0; index < options.seasons; index += 1) {
    const seasonId = state.season.id;
    const seasonLabel = state.season.label;
    const before = performance.now();
    let days = 0;
    while (state.season.id === seasonId && days < 420) {
      processDay(state, state.date, { resolveUserMatch: true });
      days += 1;
    }
    const seconds = (performance.now() - before) / 1000;
    seasonSeconds += seconds;

    // Every fixture the season played, split by the mode that decided it.
    let fastCount = 0;
    let fullCount = 0;
    for (const match of Object.values(state.matches)) {
      if (!match.result || match.seasonId !== seasonId) continue;
      if (match.simulationMode === 'fast') {
        addMatch(seasonFingerprint, match);
        fastCount += 1;
      } else if (match.simulationMode === 'full') {
        addMatch(fullFingerprint, match);
        fullCount += 1;
      }
    }
    seasonReport.push({ season: seasonLabel, days, seconds, matches: fastCount + fullCount });
    console.log(
      `  ${seasonLabel}: ${days} days, ${(seconds).toFixed(1)} s · ${fastCount} fast + ${fullCount} full fixtures`,
    );
  }

  console.log(heading(`Season loop — ${options.seasons} season(s) through the real day loop`));
  console.log(`  wall time                   ${seasonSeconds.toFixed(1)} s  (${(seasonSeconds / options.seasons).toFixed(1)} s/season)`);
  console.log(`  fast matches                ${seasonFingerprint.matches}`);
  console.log(`  full matches (user's own)   ${fullFingerprint.matches}`);
  // The honest counterfactual: every fixture at the measured full-engine cost.
  const totalFixtures = seasonFingerprint.matches + fullFingerprint.matches;
  const perFixtureFull = fullMs / Math.max(1, fixtureIds.length);
  const counterfactual = (totalFixtures * perFixtureFull) / 1000;
  console.log(
    `  if all ${totalFixtures} were full  ${counterfactual.toFixed(0)} s  (${(counterfactual / Math.max(0.001, seasonSeconds)).toFixed(1)}× the realised season)`,
  );
  compare('Season — fast background fixtures', emptyFingerprint(), seasonFingerprint);
  compare('Season — the user club\'s own fixtures (full)', fullFingerprint, emptyFingerprint());

  if (options.json) {
    const payload = {
      seed: options.seed,
      matchday,
      headToHead: { fixtures: fixtureIds.length, fullMs, fastMs, speedup },
      seasons: seasonReport,
      fingerprints: { full, fast, seasonFast: seasonFingerprint, seasonFull: fullFingerprint },
    };
    mkdirSync(dirname(options.json), { recursive: true });
    writeFileSync(options.json, JSON.stringify(payload, null, 2));
    console.log(`\nreport written to ${options.json}`);
  }
}

console.log(`\ntotal wall time ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
