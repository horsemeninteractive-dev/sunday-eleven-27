/**
 * The balance bench.
 *
 * A match engine cannot be tuned by looking at one match. A 5–1 tells you that a
 * 5–1 happened; it does not tell you whether the engine produces 5–1s too often,
 * whether the shots came from open play or set pieces, or whether the side that
 * won actually had the ball. Answering those questions needs hundreds of seeded
 * matches and a report of their *distribution* rather than their result.
 *
 * This is that. It builds a handful of scenarios from small, readable
 * differences — two even sides, a quality gap, and then one instruction changed
 * at a time — plays a seeded sample of each, and prints what came out: goals and
 * their spread, shots and how many hit the target, possession, passing, the
 * physical side of the game, and the mix of actions players actually chose (read
 * from the simulation trace, so it is what the engine did rather than what it
 * was asked to do).
 *
 * The tactical scenarios are the ones worth reading twice. A scenario that
 * changes one instruction and produces no measurable difference in behaviour
 * means that instruction is not doing anything, which is exactly the kind of
 * thing a scoreline hides.
 *
 *   npm run balance
 *   npm run balance -- --games=200
 *   npm run balance -- --only=direct --games=120
 *   npm run balance -- --quiet
 *
 * It is a developer tool. Nothing in the game imports it, it is outside the test
 * suite, and it is typechecked with everything else so it cannot rot.
 */

import type { Club } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { defaultTactics, type Tactics } from '@/domain/tactics';
import type { ActionKind } from '@/simulation/match/actions';
import { simulateToCompletion } from '@/simulation/match/engine';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { createTestGame } from '@/simulation/testSupport';

// --- Arguments -------------------------------------------------------------

interface Options {
  games: number;
  only: string | null;
  quiet: boolean;
  trace: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { games: 60, only: null, quiet: false, trace: true };
  for (const arg of argv) {
    const [name, value] = arg.replace(/^--/, '').split('=');
    switch (name) {
      case 'games':
        options.games = Math.max(1, Number(value ?? 60) || 60);
        break;
      case 'only':
        options.only = (value ?? '').toLowerCase() || null;
        break;
      case 'quiet':
        options.quiet = true;
        break;
      case 'no-actions':
        options.trace = false;
        break;
      default:
        break;
    }
  }
  return options;
}

// --- Building a scenario ---------------------------------------------------

interface Bench {
  state: GameState;
  base: Match;
  home: Club;
  away: Club;
  /** Instructions applied after the lineups exist, for the tactical scenarios. */
  tactics: (side: 'home' | 'away', patch: Partial<Tactics>) => void;
}

/**
 * A world, a fixture between two clubs in it, and the handles needed to change
 * either of them before kick-off.
 *
 * The world builder lives with the tests because that is where a world is
 * cheapest to make; a bench is exactly the same thing used deliberately rather
 * than asserted on.
 *
 * By default a bench is *normalised*: both squads are set to the same ordinary
 * 11 rating and both sides are given the same plain instructions. A generated
 * world has good clubs and bad clubs, attackers and full-backs, and managers who
 * have already picked a mentality — which is realistic and useless as a
 * baseline, because then a change in the report could be the world rather than
 * the engine. Normalising means every scenario starts in the same place and
 * moves exactly one thing, which is the only way the differences mean anything.
 * The one scenario that keeps its generated world is the one checking the engine
 * against real football.
 */
function bench(seed: string, normalise = true): Bench {
  const { state, draft } = createTestGame(seed);
  const home = state.clubs[draft.divisionClubIds[0]!]!;
  const away = state.clubs[draft.divisionClubIds[3]!]!;
  prepareMatchday(state, 1);
  const fixture = Object.values(state.matches).find(
    (match) => match.homeClubId === home.id && match.awayClubId === away.id,
  )!;
  prepareMatchday(state, fixture.matchday);
  const base = state.matches[fixture.id]!;

  if (normalise) {
    setAll(state, home.id, 11);
    setAll(state, away.id, 11);
    for (const side of ['home', 'away'] as const) {
      base.lineups[side].tactics = defaultTactics(base.lineups[side].tactics.formation);
    }
  }

  return {
    state,
    base,
    home,
    away,
    tactics: (side, patch) => {
      base.lineups[side].tactics = { ...base.lineups[side].tactics, ...patch };
    },
  };
}

/** Every attribute of a club's squad set to one value, for building a gap. */
function setAll(state: GameState, clubId: string, value: number): void {
  const club = state.clubs[clubId];
  if (!club) return;
  for (const id of club.squadIds) {
    const player = state.people[id];
    if (player?.kind !== 'player') continue;
    for (const group of Object.values(player.attributes)) {
      const bucket = group as unknown as Record<string, number>;
      for (const key of Object.keys(bucket)) bucket[key] = value;
    }
  }
}

// --- Sampling --------------------------------------------------------------

interface Sample {
  games: number;
  homeGoals: number;
  awayGoals: number;
  win: number;
  draw: number;
  loss: number;
  shotsHome: number;
  shotsAway: number;
  onTargetHome: number;
  onTargetAway: number;
  passesHome: number;
  passesAway: number;
  completedHome: number;
  completedAway: number;
  tackles: number;
  interceptions: number;
  possessionHome: number;
  corners: number;
  fouls: number;
  cards: number;
  offsides: number;
  events: number;
  commentary: number;
  /** Total goals per match, bucketed; the last bucket is "8 or more". */
  goalSpread: number[];
  scorelines: Map<string, number>;
  actions: Map<ActionKind, number>;
}

function emptySample(): Sample {
  return {
    games: 0,
    homeGoals: 0,
    awayGoals: 0,
    win: 0,
    draw: 0,
    loss: 0,
    shotsHome: 0,
    shotsAway: 0,
    onTargetHome: 0,
    onTargetAway: 0,
    passesHome: 0,
    passesAway: 0,
    completedHome: 0,
    completedAway: 0,
    tackles: 0,
    interceptions: 0,
    possessionHome: 0,
    corners: 0,
    fouls: 0,
    cards: 0,
    offsides: 0,
    events: 0,
    commentary: 0,
    goalSpread: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    scorelines: new Map(),
    actions: new Map(),
  };
}

const SPREAD_BUCKETS = 8;

/**
 * Play `games` matches from one prepared fixture, each on its own seed.
 *
 * Every game is a clone of the same kick-off, so the only thing that varies is
 * the seed — which is the point: the spread in the report is the engine's own
 * variance, not the world's.
 */
function sample(b: Bench, games: number, options: Options): Sample {
  const out = emptySample();
  for (let index = 0; index < games; index += 1) {
    const match = structuredClone(b.base);
    match.seed = 9000 + index * 13;
    const env = matchEnvironment(b.state, match, { autoManageAllBenches: true });
    if (options.trace) {
      env.trace = (entry) => {
        const action = entry.detail?.action;
        if (typeof action !== 'string') return;
        const kind = action as ActionKind;
        out.actions.set(kind, (out.actions.get(kind) ?? 0) + 1);
      };
    }
    simulateToCompletion(match, env);

    const result = match.result;
    if (!result) continue;
    out.games += 1;
    out.homeGoals += result.homeGoals;
    out.awayGoals += result.awayGoals;
    if (result.homeGoals > result.awayGoals) out.win += 1;
    else if (result.homeGoals === result.awayGoals) out.draw += 1;
    else out.loss += 1;

    const total = result.homeGoals + result.awayGoals;
    out.goalSpread[Math.min(total, SPREAD_BUCKETS)]! += 1;
    const line = `${result.homeGoals}-${result.awayGoals}`;
    out.scorelines.set(line, (out.scorelines.get(line) ?? 0) + 1);

    out.shotsHome += result.homeShots;
    out.shotsAway += result.awayShots;
    out.possessionHome += result.homePossession;
    out.corners += match.events.filter((event) => event.type === 'corner').length;
    out.fouls += match.events.filter((event) => event.type === 'foul').length;
    out.cards += match.events.filter((event) => event.type === 'yellow-card' || event.type === 'red-card').length;
    out.offsides += match.events.filter((event) => event.type === 'offside').length;
    out.events += match.events.length;
    out.commentary += match.commentary?.length ?? 0;

    for (const performance of Object.values(match.performances)) {
      out.tackles += performance.tackles || 0;
      out.interceptions += performance.interceptions || 0;
      if (performance.clubId === match.homeClubId) {
        out.onTargetHome += performance.shotsOnTarget || 0;
        out.passesHome += performance.passes || 0;
        out.completedHome += performance.passesCompleted || 0;
      } else if (performance.clubId === match.awayClubId) {
        out.onTargetAway += performance.shotsOnTarget || 0;
        out.passesAway += performance.passes || 0;
        out.completedAway += performance.passesCompleted || 0;
      }
    }
  }
  return out;
}

// --- Reporting -------------------------------------------------------------

function mean(total: number, games: number, digits = 2): number {
  if (games === 0) return 0;
  return Number((total / games).toFixed(digits));
}

function percent(part: number, whole: number, digits = 1): string {
  if (whole === 0) return '—';
  return `${((part / whole) * 100).toFixed(digits)}%`;
}

function column(value: string, width: number): string {
  return value.length > width ? value.slice(0, width) : value.padStart(width);
}

function left(value: string, width: number): string {
  return value.length > width ? value.slice(0, width) : value.padEnd(width);
}

function heading(text: string): string {
  const room = Math.max(0, 74 - text.length);
  return `\n── ${text} ${'─'.repeat(room)}`;
}

const SPREAD_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7', '8+'];

/** One scenario's detail block, in the order a manager would ask the questions. */
function reportDetail(title: string, note: string, s: Sample): void {
  const games = s.games;
  const goals = s.homeGoals + s.awayGoals;
  const shots = s.shotsHome + s.shotsAway;
  const onTarget = s.onTargetHome + s.onTargetAway;
  const passes = s.passesHome + s.passesAway;
  const completed = s.completedHome + s.completedAway;

  const lines: string[] = [];
  lines.push(`   ${note}`);
  lines.push(
    `   results           home ${percent(s.win, games)} · draw ${percent(s.draw, games)} · away ${percent(s.loss, games)}`,
  );
  lines.push(
    `   goals/match       ${mean(goals, games).toFixed(2)}   (home ${mean(s.homeGoals, games).toFixed(2)} · away ${mean(s.awayGoals, games).toFixed(2)})`,
  );
  lines.push(
    `   shots/match       ${mean(shots, games).toFixed(1)}   (on target ${mean(onTarget, games).toFixed(1)}, ${percent(onTarget, shots)})`,
  );
  lines.push(
    `   conversion        ${percent(s.homeGoals + s.awayGoals, shots)} of shots · ${percent(s.homeGoals + s.awayGoals, onTarget)} of those on target`,
  );
  lines.push(
    `   passes/match      home ${mean(s.passesHome, games).toFixed(0)} (${percent(s.completedHome, s.passesHome)} done) · away ${mean(s.passesAway, games).toFixed(0)} (${percent(s.completedAway, s.passesAway)} done)`,
  );
  lines.push(`   passing overall   ${percent(completed, passes)} completed of ${mean(passes, games).toFixed(0)} a match`);
  lines.push(
    `   possession        home ${mean(s.possessionHome, games, 1).toFixed(1)}% · away ${(100 - mean(s.possessionHome, games, 1)).toFixed(1)}%`,
  );
  lines.push(
    `   physical          fouls ${mean(s.fouls, games).toFixed(1)} · cards ${mean(s.cards, games).toFixed(2)} · offsides ${mean(s.offsides, games).toFixed(2)}`,
  );
  lines.push(
    `   winning the ball  tackles ${mean(s.tackles, games).toFixed(1)} · interceptions ${mean(s.interceptions, games).toFixed(1)} · corners ${mean(s.corners, games).toFixed(1)}`,
  );
  lines.push(`   written           events ${mean(s.events, games).toFixed(0)} · commentary ${mean(s.commentary, games).toFixed(0)} lines a match`);

  if (s.actions.size > 0) {
    const total = [...s.actions.values()].reduce((sum, value) => sum + value, 0);
    const mix = [...s.actions.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => `${kind} ${percent(count, total, 0)}`)
      .join(' · ');
    lines.push(`   actions chosen    ${mix}`);
  }

  const spread = s.goalSpread.map((count, index) => `${SPREAD_LABELS[index]}:${percent(count, games, 0)}`).join('  ');
  lines.push(`   goals a match     ${spread}`);

  const scorelines = [...s.scorelines.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([line, count]) => `${line} ${percent(count, games, 0)}`)
    .join(' · ');
  lines.push(`   common scorelines ${scorelines}`);

  process.stdout.write(`${heading(title)}\n${lines.join('\n')}\n`);
}

interface SummaryRow {
  title: string;
  games: number;
  homeWin: number;
  draw: number;
  awayWin: number;
  goals: number;
  shots: number;
  onTarget: number;
  possessionHome: number;
  passesHome: number;
  passesAway: number;
  completion: number;
  fouls: number;
  cards: number;
}

function reportSummary(rows: readonly SummaryRow[]): void {
  const header = [
    left('scenario', 34),
    column('games', 6),
    column('H-D-A', 10),
    column('goals', 6),
    column('shots', 6),
    column('onT', 5),
    column('possH', 6),
    column('passH', 6),
    column('passA', 6),
    column('cmp%', 5),
    column('fouls', 6),
    column('cards', 5),
  ].join(' ');
  const lines = rows.map((row) =>
    [
      left(row.title, 34),
      column(String(row.games), 6),
      column(
        row.games === 0
          ? '—'
          : `${Math.round((row.homeWin / row.games) * 100)}-${Math.round((row.draw / row.games) * 100)}-${Math.round((row.awayWin / row.games) * 100)}`,
        10,
      ),
      column(row.goals.toFixed(2), 6),
      column(row.shots.toFixed(1), 6),
      column(row.onTarget.toFixed(1), 5),
      column(`${row.possessionHome.toFixed(0)}%`, 6),
      column(row.passesHome.toFixed(0), 6),
      column(row.passesAway.toFixed(0), 6),
      column(`${(row.completion * 100).toFixed(0)}%`, 5),
      column(row.fouls.toFixed(1), 6),
      column(row.cards.toFixed(2), 5),
    ].join(' '),
  );
  process.stdout.write(`${heading('summary')}\n   ${header}\n${lines.map((line) => `   ${line}`).join('\n')}\n`);
}

/**
 * Where the engine sits against a real match.
 *
 * Deliberately loose and deliberately stated: these are the ranges a Sunday
 * League afternoon normally falls in, not targets to converge on. A scenario
 * outside one of them is a place to look, not a failure — the point of printing
 * it is that the numbers are read rather than assumed good.
 */
interface Band {
  label: string;
  pick: (s: Sample) => number;
  low: number;
  high: number;
  /** Shown when out of range, so the number has something to be compared with. */
  note: string;
}

const REFERENCE_BANDS: Band[] = [
  { label: 'goals/match', pick: (s) => mean(s.homeGoals + s.awayGoals, s.games), low: 2.0, high: 4.5, note: 'a match is usually 2–4' },
  { label: 'shots/match', pick: (s) => mean(s.shotsHome + s.shotsAway, s.games), low: 18, high: 30, note: 'both sides put up about 24' },
  {
    label: 'on target',
    pick: (s) => (s.shotsHome + s.shotsAway === 0 ? 0 : (s.onTargetHome + s.onTargetAway) / (s.shotsHome + s.shotsAway)),
    low: 0.3,
    high: 0.5,
    note: 'roughly a third of shots hit the target',
  },
  {
    label: 'pass completion',
    pick: (s) => (s.passesHome + s.passesAway === 0 ? 0 : (s.completedHome + s.completedAway) / (s.passesHome + s.passesAway)),
    low: 0.6,
    high: 0.8,
    note: 'a grassroots side completes about seven in ten',
  },
  { label: 'fouls/match', pick: (s) => mean(s.fouls, s.games), low: 15, high: 32, note: 'around twenty-odd a match' },
  { label: 'cards/match', pick: (s) => mean(s.cards, s.games), low: 1, high: 5, note: 'two or three is normal' },
  { label: 'home possession', pick: (s) => mean(s.possessionHome, s.games, 1), low: 48, high: 56, note: 'the home side should hold slightly more' },
  { label: 'corners/match', pick: (s) => mean(s.corners, s.games), low: 7, high: 14, note: 'about ten a match' },
];

function reportBands(sample: Sample): void {
  const lines: string[] = [];
  for (const band of REFERENCE_BANDS) {
    const value = band.pick(sample);
    const ok = value >= band.low && value <= band.high;
    const shown = value >= 1 ? value.toFixed(2) : value.toFixed(3);
    lines.push(
      `   ${ok ? 'ok  ' : '⟵   '} ${band.label.padEnd(18, ' ')} ${shown.padStart(7, ' ')}   ${ok ? `(${band.low}–${band.high})` : `${band.note} — outside ${band.low}–${band.high}`}`,
    );
  }
  process.stdout.write(
    `${heading('against a real match')}\n   read from the generated world, which is the only scenario that looks like a fixture;\n   loose bands — places to look rather than targets\n${lines.join('\n')}\n`,
  );
}

// --- Scenarios -------------------------------------------------------------

interface Scenario {
  title: string;
  note: string;
  seed: string;
  /** Keep the generated squads and instructions instead of normalising them. */
  generated?: boolean;
  /** The one scenario the sanity bands are read from: it looks like a real fixture. */
  reference?: boolean;
  build: (b: Bench) => void;
}

const SCENARIOS: Scenario[] = [
  {
    title: 'a real fixture (generated)',
    note: 'an untouched world: real squads, real managers, real instructions — this is the one checked against football',
    seed: 'balance-real',
    generated: true,
    reference: true,
    build: () => {},
  },
  {
    title: 'even quality (11 v 11)',
    note: 'two identical ordinary sides on plain instructions — the baseline everything else is read against',
    seed: 'balance-even',
    build: () => {},
  },
  {
    title: 'moderate gap (13 v 9)',
    note: 'a good side at home against a poor one',
    seed: 'balance-gap',
    build: (b) => {
      setAll(b.state, b.home.id, 13);
      setAll(b.state, b.away.id, 9);
    },
  },
  {
    title: 'wide gap (16 v 6)',
    note: 'the best team in the division against the worst — it should not become a formality',
    seed: 'balance-gap',
    build: (b) => {
      setAll(b.state, b.home.id, 16);
      setAll(b.state, b.away.id, 6);
    },
  },
  {
    title: 'away side is the better one',
    note: 'the same 13 v 9 with the good side away — the crowd should not outweigh the gap',
    seed: 'balance-gap',
    build: (b) => {
      setAll(b.state, b.home.id, 9);
      setAll(b.state, b.away.id, 13);
    },
  },
  {
    title: 'even at a neutral venue',
    note: 'the even game with no crowd to lean on, to see what home advantage is actually worth',
    seed: 'balance-even',
    build: (b) => {
      b.base.neutralVenue = true;
    },
  },
  {
    title: 'direct v short',
    note: 'the home side goes long, the away side keeps it — passing volumes should separate',
    seed: 'balance-direct',
    build: (b) => {
      b.tactics('home', { passingStyle: 'direct' });
      b.tactics('away', { passingStyle: 'short' });
    },
  },
  {
    title: 'press high v sit off',
    note: 'the home side presses up the pitch, the away side drops in — possession and where the ball is won should separate',
    seed: 'balance-press',
    build: (b) => {
      b.tactics('home', { pressing: 'high', defensiveLine: 'high' });
      b.tactics('away', { pressing: 'low', defensiveLine: 'deep', mentality: 'defensive' });
    },
  },
  {
    title: 'high tempo v slow',
    note: 'one side wants it played quickly, the other wants it slowed down',
    seed: 'balance-tempo',
    build: (b) => {
      b.tactics('home', { tempo: 'high' });
      b.tactics('away', { tempo: 'slow' });
    },
  },
  {
    title: 'wide v central',
    note: 'the home side gets it wide and crosses, the away side goes through the middle',
    seed: 'balance-focus',
    build: (b) => {
      b.tactics('home', { attackingFocus: 'wide' });
      b.tactics('away', { attackingFocus: 'central' });
    },
  },
  {
    title: 'very attacking v low block',
    note: 'the classic mismatch of intent, at equal quality — the block should concede chances without the game running away',
    seed: 'balance-block',
    build: (b) => {
      b.tactics('home', { mentality: 'very-attacking', defensiveLine: 'high', tempo: 'high' });
      b.tactics('away', { mentality: 'very-defensive', defensiveLine: 'deep', pressing: 'low' });
    },
  },
];

// --- Main ------------------------------------------------------------------

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const chosen = options.only
    ? SCENARIOS.filter((scenario) => scenario.title.toLowerCase().includes(options.only!) || scenario.seed.includes(options.only!))
    : SCENARIOS;

  if (chosen.length === 0) {
    process.stdout.write(
      `No scenario matches "${options.only}".\nKnown scenarios:\n${SCENARIOS.map((s) => `  ${s.title}`).join('\n')}\n`,
    );
    return;
  }

  process.stdout.write(
    [
      '',
      'Sunday Eleven 27 — match balance bench',
      `   ${options.games} seeded games a scenario · ${chosen.length} scenarios · ${options.games * chosen.length} matches`,
      options.trace ? '   action mix read from the simulation trace' : '   action mix off (--no-actions)',
    ].join('\n') + '\n',
  );

  const started = Date.now();
  const rows: SummaryRow[] = [];
  let reference: Sample | null = null;

  for (const scenario of chosen) {
    const b = bench(scenario.seed, !scenario.generated);
    scenario.build(b);
    const result = sample(b, options.games, options);

    if (!options.quiet) reportDetail(scenario.title, scenario.note, result);
    else process.stdout.write(`   … ${scenario.title}: ${result.games} games\n`);

    if (scenario.reference) reference = result;

    const passes = result.passesHome + result.passesAway;
    const completed = result.completedHome + result.completedAway;
    rows.push({
      title: scenario.title,
      games: result.games,
      homeWin: result.win,
      draw: result.draw,
      awayWin: result.loss,
      goals: mean(result.homeGoals + result.awayGoals, result.games),
      shots: mean(result.shotsHome + result.shotsAway, result.games),
      onTarget: mean(result.onTargetHome + result.onTargetAway, result.games),
      possessionHome: mean(result.possessionHome, result.games, 1),
      passesHome: mean(result.passesHome, result.games),
      passesAway: mean(result.passesAway, result.games),
      completion: passes === 0 ? 0 : completed / passes,
      fouls: mean(result.fouls, result.games),
      cards: mean(result.cards, result.games),
    });
  }

  reportSummary(rows);
  if (reference) reportBands(reference);
  else if (!options.only) process.stdout.write('\n');

  process.stdout.write(`\n   ${((Date.now() - started) / 1000).toFixed(1)}s\n\n`);
}

main();
