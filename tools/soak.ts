/**
 * The multi-season soak.
 *
 * The bench (`tools/balance.ts`) asks whether one match looks like football. This
 * asks the harder question: does one *career* look like a career? It plays the
 * game forward with nobody at the controls — no signings, no team talks, no
 * transfers — and reads the world at the end of every season, so drift is found
 * in a report rather than in year twelve of somebody's save.
 *
 * What it is looking for is the slow stuff. A single season hides it: squads that
 * quietly shrink, an unattached pool that only grows, ability that creeps upward,
 * money that only ever goes in, a fixture that gets rearranged so often that the
 * season never actually ends. None of that shows up in a unit test and all of it
 * shows up here.
 *
 *   npm run soak
 *   npm run soak -- --seasons=20
 *   npm run soak -- --seasons=15 --seed=soak-scratch --club=3
 *   npm run soak -- --districts=2          # a smaller county, as the old soaks ran
 *   npm run soak -- --budget=260000        # a state-size budget, in KB
 *   npm run soak -- --json=soak-reports/run.json
 *   npm run soak -- --quiet
 *
 * It is a developer tool. Nothing in the game imports it, it is outside the test
 * suite, and it is typechecked with everything else so it cannot rot. See
 * `SOAK.md` for how to read the report.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ALDERFORDSHIRE_DISTRICTS } from '@/domain/districts';
import {
  CALENDAR_INVARIANTS,
  formatTrend,
  formatViolations,
  runSoak,
  summariseViolations,
  type SoakOptions,
  type SoakResult,
  type SoakSnapshot,
} from '@/simulation/soak';

// --- Arguments -------------------------------------------------------------

interface Options extends SoakOptions {
  quiet: boolean;
  json: string | null;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    seed: 'soak',
    seasons: 10,
    clubIndex: 0,
    // The whole county, because that is what a career founded today is founded
    // in and what the state budget is set against. `--districts=2` is the smaller
    // world the soaks recorded in SOAK.md were measured on.
    districts: ALDERFORDSHIRE_DISTRICTS.length,
    quiet: false,
    json: null,
  };
  for (const arg of argv) {
    const [name, value] = arg.replace(/^--/, '').split('=');
    switch (name) {
      case 'seasons':
        options.seasons = Math.max(1, Number(value ?? 10) || 10);
        break;
      case 'seed':
        options.seed = value || 'soak';
        break;
      case 'club':
        options.clubIndex = Math.max(0, Number(value ?? 0) || 0);
        break;
      case 'districts':
        options.districts = Math.max(1, Number(value ?? ALDERFORDSHIRE_DISTRICTS.length) || 1);
        break;
      // The state-size budget, in KB — the unit the benchmark reports sizes in.
      // Left out, the band is used; given, it is the number this run is held to.
      case 'budget': {
        const kb = Number(value);
        if (Number.isFinite(kb) && kb > 0) options.stateBudgetBytes = Math.round(kb * 1024);
        break;
      }
      case 'json':
        options.json = value || 'soak-reports/soak.json';
        break;
      case 'quiet':
        options.quiet = true;
        break;
      default:
        break;
    }
  }
  return options;
}

// --- Reporting -------------------------------------------------------------

function heading(text: string): string {
  const room = Math.max(0, 74 - text.length);
  return `\n── ${text} ${'─'.repeat(room)}`;
}

function padEnd(value: string, width: number): string {
  return value.length > width ? value.slice(0, width) : value.padEnd(width);
}

/** The first and last season side by side, so the drift is a sentence. */
function reportDrift(result: SoakResult): void {
  const first = result.snapshots[0];
  const last = result.snapshots[result.snapshots.length - 1];
  if (!first || !last || result.snapshots.length < 2) return;

  const rows: Array<[string, string, string]> = [
    ['ability (mean)', first.abilityMean.toFixed(2), last.abilityMean.toFixed(2)],
    ['squad (mean)', first.squadMean.toFixed(1), last.squadMean.toFixed(1)],
    ['age p50 / p90', `${first.ageP50} / ${first.ageP90}`, `${last.ageP50} / ${last.ageP90}`],
    ['balance (mean)', String(first.balanceMean), String(last.balanceMean)],
    ['clubs in the red', String(first.clubsInTheRed), String(last.clubsInTheRed)],
    ['unattached', String(first.unattached), String(last.unattached)],
    ['goals a match', first.goalsPerMatch.toFixed(2), last.goalsPerMatch.toFixed(2)],
    ['days a season', String(first.days), String(last.days)],
    ['postponed', String(first.postponements), String(last.postponements)],
    ['abandoned', String(first.abandoned), String(last.abandoned)],
  ];
  const lines = rows.map(([label, before, after]) => `   ${padEnd(label, 18)} ${padEnd(before, 10)} → ${after}`);
  process.stdout.write(
    `${heading(`drift — season 1 against season ${result.snapshots.length}`)}\n${lines.join('\n')}\n`,
  );
}

/**
 * The save against its budget: the one number the run exists to guard.
 *
 * The fresh reading is printed beside it because the two together are the whole
 * story of where the state is — the world a career opens in against the state a
 * season of football leaves in it — and because the largest season of the run is
 * the number the budget is about, not the last one.
 */
function reportStateSize(result: SoakResult): void {
  const kb = (bytes: number): string => `${Math.round(bytes / 1024).toLocaleString('en-US')} KB`;
  const largest = result.snapshots.reduce<SoakSnapshot | null>(
    (peak, snapshot) => (!peak || snapshot.stateBytes > peak.stateBytes ? snapshot : peak),
    null,
  );
  const budget = result.stateBudgetBytes;
  const headroom = budget - (largest?.stateBytes ?? 0);
  const rows: Array<[string, string]> = [
    ['fresh (no season)', `${kb(result.stateBytesFresh)} (${result.stateBytesFresh.toLocaleString('en-US')} bytes)`],
    [
      'end of season',
      largest
        ? `${kb(largest.stateBytes)} — largest of ${result.seasons}, at the close of ${largest.label}`
        : 'not measured — no season played',
    ],
    ['budget (band)', `${kb(budget)} (${budget.toLocaleString('en-US')} bytes)`],
    [
      'headroom',
      largest
        ? `${kb(headroom)} (${((headroom / budget) * 100).toFixed(1)}% of the budget)`
        : '—',
    ],
    ['world', `${result.districts} districts · ${largest?.clubs ?? 0} clubs`],
  ];
  const lines = rows.map(([label, value]) => `   ${padEnd(label, 20)} ${value}`);
  process.stdout.write(`${heading('state size')}\n${lines.join('\n')}\n`);
}

function reportSummary(result: SoakResult): void {
  const counts = summariseViolations(result.violations);
  const fails = result.violations.filter((item) => item.severity === 'fail').length;
  const warns = result.violations.length - fails;
  // Every invariant in the calendar's own group is named whether or not it fired,
  // so a clean report says "0" about each of them rather than saying nothing: a
  // count of zero is a check that ran and held, and a line that is missing is not.
  const tally = new Map(counts.map((row) => [row.invariant, row.count]));
  for (const invariant of CALENDAR_INVARIANTS) if (!tally.has(invariant)) tally.set(invariant, 0);
  const lines = [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([invariant, count]) => `   ${padEnd(invariant, 30)} ${count}`);

  const headline =
    fails === 0
      ? `held up over ${result.seasons} season(s) — ${warns} warning(s)`
      : `${fails} failure(s), ${warns} warning(s) over ${result.seasons} season(s)`;

  process.stdout.write(`${heading('summary')}\n   ${headline}\n${lines.join('\n')}\n`);
}

// --- Main ------------------------------------------------------------------

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  process.stdout.write(
    [
      '',
      'Sunday Eleven 27 — multi-season soak',
      `   seed "${options.seed}" · ${options.seasons} season(s) · ${options.districts} district(s) · taking over club ${options.clubIndex}`,
      '   no signings, no team talks, no transfers: the world only moves itself',
    ].join('\n') + '\n',
  );

  const result = runSoak({
    seed: options.seed,
    seasons: options.seasons,
    clubIndex: options.clubIndex,
    districts: options.districts,
    stateBudgetBytes: options.stateBudgetBytes,
    onSeason: (snapshot) => {
      process.stdout.write(
        `   … season ${snapshot.season}/${options.seasons}: ${snapshot.label}, finished ${
          snapshot.userPosition ?? '–'
        }, ${snapshot.days} days\n`,
      );
    },
  });

  if (!options.quiet) {
    process.stdout.write(`${heading('trend')}\n   ${formatTrend(result.snapshots).split('\n').join('\n   ')}\n`);
    reportDrift(result);
  }

  process.stdout.write(`${heading('violations')}\n${formatViolations(result.violations)}\n`);
  reportStateSize(result);
  reportSummary(result);

  const fails = result.violations.filter((item) => item.severity === 'fail').length;
  process.stdout.write(
    `\n   ${result.seasons} season(s) in ${result.seconds}s · ${result.snapshots.length} snapshot(s)${
      fails > 0 ? ' · FAILED' : ''
    }\n\n`,
  );

  if (options.json) {
    mkdirSync(dirname(options.json), { recursive: true });
    writeFileSync(options.json, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stdout.write(`   wrote ${options.json}\n\n`);
  }

  if (fails > 0) process.exitCode = 1;
}

main();
