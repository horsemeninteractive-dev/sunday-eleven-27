/**
 * The background-simulation benchmark.
 *
 * Three questions, and it answers all of them with numbers rather than adjectives:
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
 *  3. **What is the world it is running, in numbers?** The settlements and their
 *     kinds, the ones with no club in them, the clubs in each division, the
 *     fixtures a season holds, the calendar and its span, each cup's field and
 *     its rounds, the people in the county, and the size the whole state
 *     serialises to — because a world that grows is a world whose save grows
 *     with it, and growth nobody writes down is growth nobody notices until a
 *     phone stops autosaving. The same readings are the `world` object of the
 *     report.
 *
 *   npm run benchmark
 *   npm run benchmark -- --fixtures=18 --seasons=2
 *   npm run benchmark -- --seed=bench-2 --json=reports/bench.json
 *
 * It is a developer tool: nothing in the game imports it, and it is outside the
 * test suite. `npm run soak` remains the long-run correctness harness — this one
 * is about cost, calibration and the size of the world.
 *
 * `--json` writes the report whenever it is asked for, seasons or no seasons: the
 * world audit is a reading of the world the season was *built from*, and asking
 * for it does not mean playing a season first.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { FRIENDLY_COMPETITION_ID } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { ISODate } from '@/domain/ids';
import type { Match } from '@/domain/match';
import type { SettlementKind } from '@/domain/world';
import { createTestGame } from '@/simulation/testSupport';
import { daysBetween } from '@/simulation/calendar';
import { processDay } from '@/simulation/day';
import { publishEvents } from '@/simulation/news';
import { startNextSeason } from '@/simulation/season';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { cupCompetitions, divisionsOf, fixtureIdsOnMatchday, pyramidsOf } from '@/simulation/pyramid';
import { isLeagueMatchday, leagueMatchdayCount, nextMatchday } from '@/simulation/timeline';
import { simulateMatchFast } from '@/simulation/fastMatch';
import { simulateMatchHeadless } from '@/simulation/match/matchEngine';
import { computeTeamStrength } from '@/simulation/match/teamStrength';
import { tacticalProfile } from '@/simulation/match/tacticsModel';
import { isPlayer } from '@/domain/person';
import { ALDERFORDSHIRE_DISTRICTS } from '@/domain/districts';
import { SOAK_BANDS, stateSizeBytes } from '@/simulation/soak';

/** The county as a career founded today gets it. */
const COUNTY_DISTRICTS = ALDERFORDSHIRE_DISTRICTS.length;

// --- Arguments -------------------------------------------------------------

interface Options {
  seed: string;
  fixtures: number;
  seasons: number;
  clubIndex: number;
  /** How many of the county's districts the measured career is founded with. */
  districts: number;
  json: string | null;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    seed: 'bench',
    fixtures: 18,
    seasons: 1,
    clubIndex: 0,
    // The whole county, because that is what a career founded today is: a
    // benchmark that measured a smaller world would be measuring a world the
    // game no longer builds.
    districts: COUNTY_DISTRICTS,
    json: null,
  };
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
      case 'districts':
        options.districts = Math.max(1, Number(value ?? COUNTY_DISTRICTS) || COUNTY_DISTRICTS);
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

// --- The world, as it stands --------------------------------------------------

/** An integer with its thousands separated, for a size read at a glance. */
function thousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** One reading, labelled the way every other line in this tool is. */
function line(label: string, value: string): void {
  console.log(`  ${padEnd(label, 28)}${value}`);
}

/**
 * The state's size, by the part of it that is taking up the room.
 *
 * The one number a save's size needs beside it is *where* it went: a county that
 * grows to six ladders grows its fixture list threefold, and a reading that said
 * only "195 MB" would leave the next person guessing whether the world or the
 * record of a season in it is what to look at. Measured the same way the total is
 * (`JSON.stringify` of each top-level key, largest first), so the parts add up to
 * the whole.
 */
function sizeBreakdown(state: GameState, count = 5): string {
  const bytes = (value: unknown) => { try { return JSON.stringify(value)?.length ?? 0; } catch { return 0; } };
  return Object.entries(state)
    .map(([key, value]) => ({ key, size: bytes(value) }))
    .sort((a, b) => b.size - a.size)
    .slice(0, count)
    .map((entry) => `${entry.key} ${thousands(Math.round(entry.size / 1024))} KB`)
    .join(' · ');
}

/**
 * The world, read as numbers rather than described in adjectives.
 *
 * Every reading here is the one the world audit of
 * `WORLD_EXPANSION_ARCHITECTURE.md` §1.1 took with a throwaway script, kept in
 * the tool that was already measuring the world so that growing it always has a
 * number attached: the settlements and their kinds, the ones no club plays in,
 * the clubs in each division, the fixtures a season holds, the calendar and its
 * span, what each cup's field and rounds are, the people in the county, and the
 * size the whole state serialises to.
 *
 * It is taken as the season was *built*, before a single day is prepared, which
 * is what makes two runs comparable — and it is why `stateBytes` is the size a
 * career opens with rather than the size it has after a year of news. What a
 * season does to that number is measured separately, at the end of the day loop.
 */
interface WorldAudit {
  settlements: {
    total: number;
    kinds: Record<SettlementKind, number>;
    withClub: number;
    withoutClub: number;
    /** Their names, for a caller that wants to see which places were left out. */
    withoutClubNames: string[];
  };
  clubs: { total: number; active: number };
  pyramids: Array<{
    id: string;
    name: string;
    level: number;
    regionId: string;
    divisions: Array<{ id: string; name: string; tier: number; clubs: number }>;
  }>;
  fixtures: { total: number; league: number; cup: number; friendly: number };
  calendar: {
    entries: number;
    leagueMatchdays: number;
    cupRounds: number;
    firstDate: ISODate | null;
    lastDate: ISODate | null;
    /** Days from the first calendar date to the last, as `daysBetween` counts them. */
    spanDays: number;
    seasonStart: ISODate;
    seasonEnd: ISODate;
  };
  cups: Array<{
    id: string;
    name: string;
    entrants: number;
    round: number;
    complete: boolean;
    plannedRounds: number;
    /** Each round of the plan: the clubs it knows about, and the ones that play. */
    rounds: Array<{ round: number; field: number; entrants: number }>;
  }>;
  people: { total: number; players: number; others: number; playersPerClub: number };
  /**
   * The size of the state, by the one reading there is: `stateSizeBytes`. The
   * same number the soak's state budget holds the close of a season to, in the
   * same units, so a world that grows here is a world that grows there.
   */
  stateBytes: number;
  /** The biggest top-level keys, largest first: where the size actually is. */
  largest: string;
}

function worldAudit(state: GameState): WorldAudit {
  const towns = Object.values(state.world.towns);
  const clubs = Object.values(state.clubs);
  const active = clubs.filter((club) => club.active);

  const kinds: Record<SettlementKind, number> = { town: 0, 'small-town': 0, village: 0, hamlet: 0 };
  for (const town of towns) kinds[town.kind] += 1;

  /*
   * A settlement counts as having a club only while that club is still playing.
   * A folded club sits in the archive and is no longer anybody's Sunday, so a
   * town whose only club folded is a town without one — which is exactly the
   * reading the expansion plan needs, since those are the places a second
   * pyramid's clubs are minted into.
   */
  const townsWithAClub = new Set(active.map((club) => club.townId));
  const withoutClub = towns.filter((town) => !townsWithAClub.has(town.id));

  const pyramids = pyramidsOf(state).map((pyramid) => ({
    id: pyramid.id,
    name: pyramid.name,
    level: pyramid.level,
    regionId: pyramid.regionId,
    divisions: divisionsOf(state, pyramid.id).map((division) => ({
      id: division.id,
      name: division.name,
      tier: division.tier,
      clubs: division.clubIds.length,
    })),
  }));

  /*
   * A fixture is counted by the competition it belongs to, and a friendly has no
   * competition record at all — friendlies are football without a competition, so
   * they are recognised by their own id rather than by a record that does not
   * exist. Cup ties are counted as they exist, which on a season just built means
   * the round that has been drawn and no more: a knockout has no fixtures until
   * somebody is drawn into it.
   */
  const fixtures = { total: 0, league: 0, cup: 0, friendly: 0 };
  for (const match of Object.values(state.matches)) {
    fixtures.total += 1;
    const competition = state.competitions[match.competitionId];
    if (match.competitionId === FRIENDLY_COMPETITION_ID) fixtures.friendly += 1;
    else if (competition?.kind === 'cup') fixtures.cup += 1;
    else if (competition?.kind === 'league') fixtures.league += 1;
  }

  const calendar = state.season.calendar;
  let firstDate: ISODate | null = null;
  let lastDate: ISODate | null = null;
  for (const entry of calendar) {
    if (firstDate === null || entry.date < firstDate) firstDate = entry.date;
    if (lastDate === null || entry.date > lastDate) lastDate = entry.date;
  }

  const cups = cupCompetitions(state).map((cup) => ({
    id: cup.id,
    name: cup.name,
    entrants: cup.clubIds.length,
    round: cup.cup?.round ?? 0,
    complete: cup.cup?.complete ?? false,
    plannedRounds: cup.cup?.plan?.length ?? 0,
    rounds: (cup.cup?.plan ?? []).map((entry) => ({
      round: entry.round,
      field: entry.field,
      entrants: entry.entrants,
    })),
  }));

  const people = Object.values(state.people);
  const players = people.filter(isPlayer).length;

  return {
    settlements: {
      total: towns.length,
      kinds,
      withClub: towns.length - withoutClub.length,
      withoutClub: withoutClub.length,
      withoutClubNames: withoutClub.map((town) => town.name).sort(),
    },
    clubs: { total: clubs.length, active: active.length },
    pyramids,
    fixtures,
    calendar: {
      entries: calendar.length,
      leagueMatchdays: leagueMatchdayCount(state),
      // Everything on the calendar that is not a league Sunday is a cup round.
      cupRounds: calendar.filter((entry) => !isLeagueMatchday(state, entry.matchday)).length,
      firstDate,
      lastDate,
      spanDays: firstDate && lastDate ? daysBetween(firstDate, lastDate) : 0,
      seasonStart: state.season.startDate,
      seasonEnd: state.season.endDate,
    },
    cups,
    people: {
      total: people.length,
      players,
      others: people.length - players,
      playersPerClub: active.length === 0 ? 0 : Math.round((players / active.length) * 10) / 10,
    },
    stateBytes: stateSizeBytes(state),
    largest: sizeBreakdown(state),
  };
}

/** Say it, one line a reading, in the order the world audit reads the world. */
function printWorldAudit(audit: WorldAudit): void {
  console.log(heading('The world, as it stands'));

  const kinds = audit.settlements.kinds;
  line(
    'settlements',
    `${audit.settlements.total} · ${kinds.town} town, ${kinds['small-town']} small-town, ${kinds.village} village, ${kinds.hamlet} hamlet`,
  );
  const names = audit.settlements.withoutClubNames;
  line(
    'with a club',
    `${audit.settlements.withClub} · ${audit.settlements.withoutClub} without one${
      names.length === 0 ? '' : ` (${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''})`
    }`,
  );
  line('clubs', `${audit.clubs.active} active of ${audit.clubs.total}`);

  for (const pyramid of audit.pyramids) {
    const sizes = pyramid.divisions.map((division) => String(division.clubs)).join(' / ');
    line('divisions', `${sizes || 'none'}  ·  ${pyramid.name} (level ${pyramid.level})`);
  }

  const fixtures = audit.fixtures;
  line(
    'fixtures a season',
    `${fixtures.total} · ${fixtures.league} league, ${fixtures.cup} cup, ${fixtures.friendly} friendly`,
  );
  const calendar = audit.calendar;
  line(
    'calendar',
    `${calendar.entries} entries · ${calendar.leagueMatchdays} league Sundays, ${calendar.cupRounds} cup rounds`,
  );
  line(
    'span',
    `${calendar.firstDate ?? '—'} → ${calendar.lastDate ?? '—'}  (${calendar.spanDays} days, season ${calendar.seasonStart} → ${calendar.seasonEnd})`,
  );

  for (const cup of audit.cups) {
    // A cup with a plan and no clubs in it yet is not a cup that lost its field:
    // a knockout whose entrants are the round above's losers is drawn into as
    // that round finishes, so "no entrants" is a state rather than a fault.
    const entrants = cup.entrants === 0 ? 'no entrants yet' : `${cup.entrants} entrants`;
    line(
      cup.name,
      `${entrants}, round ${cup.round} of ${cup.plannedRounds}${cup.complete ? ', complete' : ''}`,
    );
    if (cup.rounds.length > 0) {
      line('  fields (field·entrants)', cup.rounds.map((entry) => `${entry.field}·${entry.entrants}`).join(' → '));
    }
  }

  line(
    'people',
    `${audit.people.total} · ${audit.people.players} players, ${audit.people.others} others · ${audit.people.playersPerClub} a club`,
  );
  line('state', `${thousands(Math.round(audit.stateBytes / 1024))} KB (${thousands(audit.stateBytes)} bytes)`);
  line('  largest keys', audit.largest);
}

// --- Running ---------------------------------------------------------------

const options = parseArgs(process.argv.slice(2));
const { state } = createTestGame(options.seed, options.clubIndex, 2026, options.districts);
// 1. The world as it stands: read before a single day is prepared, so it is the
// shape the season was built with rather than the shape a season left behind.
const world = worldAudit(state);
const startedAt = Date.now();

// 2. Head to head: the same fixtures, both modes, timed.
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
console.log(`districts: ${options.districts}  ·  fixtures: ${fixtureIds.length}`);

printWorldAudit(world);

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

// 3. The real day loop: a season, or several, exactly as the soak runs it.
const seasonFingerprint = emptyFingerprint();
const fullFingerprint = emptyFingerprint();
const seasonReport: Array<{ season: string; days: number; seconds: number; matches: number }> = [];
let seasonSeconds = 0;
let seasonDays = 0;
let stateBytesAtSeasonEnd = 0;
// The state-size budget the soak holds every season to (`SOAK_BANDS`), read here
// so the two tools cannot disagree about what the state is allowed to be: this is
// the measurement that sets it, and this is where a benchmark's own world is
// checked against it.
const stateBudgetBytes = SOAK_BANDS.stateBudgetBytes;
if (options.seasons > 0) {

  for (let index = 0; index < options.seasons; index += 1) {
    const seasonId = state.season.id;
    const seasonLabel = state.season.label;
    const before = performance.now();
    // The season closes *inside* the day loop: `applySeasonBoundary` settles the
    // tables, archives the season and sets `season.finished`. The next season's id
    // only arrives with `startNextSeason`, which the caller makes — so a loop that
    // watched the id played on for four hundred days through a season that was
    // already over, and read the state four hundred days of nothing had grown into
    // as "the state at a season end".
    let days = 0;
    while (!state.season.finished && state.season.id === seasonId && days < 420) {
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
    seasonDays += days;

    // What a season of results, news, money and relationships does to the size
    // the game writes on every save: read as each season ends, which is where
    // the state peaks — the roll-over below rebuilds `state.matches`, and
    // nothing in the days in between makes anything smaller.
    stateBytesAtSeasonEnd = Math.max(stateBytesAtSeasonEnd, stateSizeBytes(state));

    // The season closes inside the day loop (`applySeasonBoundary`), but the next
    // one is the caller's: the store rolls over when the manager starts it, and
    // the soak makes the same two calls. Without this the loop's second turn
    // would run days through a season already over and report the same season
    // twice, so `--seasons=2` would play one.
    if (index < options.seasons - 1) publishEvents(state, startNextSeason(state));
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

  // The other half of the world audit: the same state, once a season has been
  // played through it. The fresh reading is the one above, in the world audit.
  line(
    'state, at a season end',
    `${thousands(Math.round(stateBytesAtSeasonEnd / 1024))} KB (from ${thousands(Math.round(world.stateBytes / 1024))} KB) · largest of ${options.seasons}, after ${seasonDays} day(s)`,
  );
  line('  largest keys', sizeBreakdown(state));
  line(
    '  state budget',
    `${thousands(Math.round(stateBudgetBytes / 1024))} KB · ${thousands(Math.round((stateBudgetBytes - stateBytesAtSeasonEnd) / 1024))} KB of headroom · ${
      stateBytesAtSeasonEnd <= stateBudgetBytes ? 'within budget' : 'OVER BUDGET'
    } (the soak holds every season to this)`,
  );
}

if (options.json) {
  const payload = {
    seed: options.seed,
    districts: options.districts,
    matchday,
    world,
    headToHead: { fixtures: fixtureIds.length, fullMs, fastMs, speedup },
    seasons: seasonReport,
    // Null rather than zero when no season was played: "not measured" and
    // "measured and small" are different answers. Otherwise the largest state
    // the loop read as a season ended, and the days it took to get there.
    stateBytesAtSeasonEnd: options.seasons > 0 ? stateBytesAtSeasonEnd : null,
    // The budget the soak holds a season to, and whether this world is inside it.
    stateBudgetBytes,
    withinStateBudget: options.seasons > 0 ? stateBytesAtSeasonEnd <= stateBudgetBytes : null,
    seasonDays,
    fingerprints: { full, fast, seasonFast: seasonFingerprint, seasonFull: fullFingerprint },
  };
  mkdirSync(dirname(options.json), { recursive: true });
  writeFileSync(options.json, JSON.stringify(payload, null, 2));
  console.log(`\nreport written to ${options.json}`);
}

console.log(`\ntotal wall time ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
