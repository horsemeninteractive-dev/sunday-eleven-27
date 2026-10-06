import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestGame } from '@/simulation/testSupport';
import { processDay } from '@/simulation/day';
import type { Match } from '@/domain/match';

/**
 * One football simulation, in two modes.
 *
 * `day.ts` used to play every AI fixture with the old minute engine while only
 * the watched match ran on the new `MatchEngine`. This file is the guard that it
 * never goes back: a source scan proves no production file imports the old
 * engine's simulation entry, and a full fixture day proves every game is decided
 * by the new code — the manager's own fixture by the full `MatchEngine`, and the
 * games nobody watches by the fast background mode beside it.
 *
 * The two modes share the new engine's vocabulary, which is what the matchday
 * test pins: the `half`/`period` model the old minute engine never wrote,
 * possession written to ticks from the same seconds the result is built from, a
 * full XI a side on the record, and a scoreline that adds up to the goal events.
 * Only the full engine additionally carries the ordinary-play texture (the pass,
 * carry and tackle stream) — that is what the watched match is drawn from, and
 * the second test proves the manager's own fixture still has it.
 */

/** Production source files: TypeScript, everything but tests, under `src`. */
function productionFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      out.push(full);
    }
  };
  walk(join(root, 'src'));
  return out;
}

/**
 * Walk the calendar to the first proper league Sunday — many fixtures at once —
 * and hand back the world and that day's outcome.
 */
function firstFullMatchday() {
  const game = createTestGame('engine-migration');
  for (let day = 0; day < 200; day += 1) {
    const outcome = processDay(game.state, game.state.date, { resolveUserMatch: true });
    if (outcome.results.length >= 8) return { ...game, played: outcome };
  }
  throw new Error('no full fixture day was reached');
}

describe('the game plays one football simulation', () => {
  it('has no production call site of the old match engine', () => {
    const root = process.cwd();
    const offenders: string[] = [];

    // A *value* import of the old engine module — `match/engine` or, from inside
    // the match folder, `./engine`. A `import type` is not a call site and is
    // tolerated (a couple of the old engine's own modules share its types).
    const valueImport = /import\s+(?!type\b)[^;]*?from\s+['"]([^'"]*\/engine)['"]/g;
    // The old engine's simulation entries, by name. Defined in the old engine
    // module itself, so that file is the one place they are allowed to appear.
    const entryCalls = /\b(simulateToCompletion|advanceMinute|beginMatch)\s*\(/;
    const oldEngineModule = 'src/simulation/match/engine.ts';
    // Strip comments first, so a doc block that merely *names* an entry is not a
    // call site.
    const stripComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    for (const file of productionFiles(root)) {
      const rel = relative(root, file).replace(/\\/g, '/');
      const source = stripComments(readFileSync(file, 'utf8'));
      if (valueImport.test(source)) offenders.push(`${rel} imports the old engine`);
      valueImport.lastIndex = 0;
      if (rel !== oldEngineModule && entryCalls.test(source)) {
        offenders.push(`${rel} calls an old-engine simulation entry`);
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('decides every fixture on a full matchday, and names the mode that did', () => {
    const { state, played } = firstFullMatchday();

    const matches: Match[] = played.results
      .map((summary) => state.matches[summary.matchId])
      .filter((match): match is Match => Boolean(match));
    expect(matches.length).toBeGreaterThanOrEqual(8);

    for (const match of matches) {
      const result = match.result;
      expect(result, `${match.id} has no result`).not.toBeNull();
      // The mode is on the record, not inferred from the call site.
      const involvesUser = match.homeClubId === state.userClubId || match.awayClubId === state.userClubId;
      expect(match.simulationMode, `${match.id} has no mode`).toBe(involvesUser ? 'full' : 'fast');
      // The new engine's period model, which the old engine never wrote.
      expect(['first-half', 'second-half', 'extra-first', 'extra-second']).toContain(match.period);
      expect(match.played).toBe(true);
      expect(match.status).toBe('finished');
      // Possession is written to ticks from the same seconds the result uses.
      expect(match.possessionTicks.home + match.possessionTicks.away).toBeGreaterThan(0);
      expect(result!.homePossession + result!.awayPossession).toBe(100);
      // A full XI a side, on the record both modes keep.
      expect(Object.keys(match.performances).length).toBeGreaterThanOrEqual(22);
      // The scoreline adds up to the goal events, however they arose.
      const goals = match.events.filter(
        (event) => event.type === 'goal' || event.type === 'own-goal' || event.type === 'penalty-scored',
      ).length;
      expect(goals).toBe(result!.homeGoals + result!.awayGoals);
    }

    // Both modes really were used, so neither arm of the assertion above is
    // vacuous.
    expect(matches.some((match) => match.simulationMode === 'fast')).toBe(true);
    expect(matches.some((match) => match.simulationMode === 'full')).toBe(true);
  }, 120_000);

  it("still plays the manager's own fixture on the full engine", () => {
    const { state, played } = firstFullMatchday();
    const mine = played.results
      .map((summary) => state.matches[summary.matchId])
      .filter((match): match is Match => Boolean(match))
      .filter((match) => match.simulationMode === 'full');

    for (const match of mine) {
      expect(match.period).toBe('second-half');
      expect(match.result).not.toBeNull();
      // The full engine's own fingerprint: the ordinary-play record nobody else
      // produces, which the replay, the timeline and the statistics panel read.
      expect(match.events.some((event) => event.type === 'pass')).toBe(true);
      expect(match.events.some((event) => event.type === 'kick-off')).toBe(true);
      // A watched match is the football nobody summarised away.
      expect(match.events.length).toBeGreaterThan(200);
    }
  }, 120_000);
});
