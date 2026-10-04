import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestGame } from '@/simulation/testSupport';
import { processDay } from '@/simulation/day';
import type { Match } from '@/domain/match';

/**
 * One football simulation.
 *
 * `day.ts` used to play every AI fixture with the old minute engine while only
 * the watched match ran on the new `MatchEngine`. This file is the guard that it
 * never goes back: a source scan proves no production file imports the old
 * engine's simulation entry, and a full fixture day proves the games nobody
 * watches are decided by the same engine the manager watches — a headless match
 * carries the new engine's own fingerprint (its `half`/`period` model, its
 * possession seconds written to ticks, and its ordinary-play record).
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

  it('decides every fixture on a full matchday with the new engine', () => {
    const { state } = createTestGame('engine-migration');
    let played: ReturnType<typeof processDay> | null = null;
    // Walk the calendar to the first proper league Sunday (many fixtures at once).
    for (let day = 0; day < 200 && !played; day += 1) {
      const outcome = processDay(state, state.date, { resolveUserMatch: true });
      if (outcome.results.length >= 8) played = outcome;
    }
    expect(played, 'no full fixture day was reached').not.toBeNull();

    const matches: Match[] = played!.results
      .map((summary) => state.matches[summary.matchId])
      .filter((match): match is Match => Boolean(match));
    expect(matches.length).toBeGreaterThanOrEqual(8);

    for (const match of matches) {
      const result = match.result;
      expect(result, `${match.id} has no result`).not.toBeNull();
      // The new engine's period model, which the old engine never wrote.
      expect(['first-half', 'second-half', 'extra-first', 'extra-second']).toContain(match.period);
      expect(match.played).toBe(true);
      expect(match.status).toBe('finished');
      // Possession is written to ticks from the same seconds the result uses.
      expect(match.possessionTicks.home + match.possessionTicks.away).toBeGreaterThan(0);
      expect(result!.homePossession + result!.awayPossession).toBe(100);
      // A full XI a side, with the record that only the new engine keeps.
      expect(Object.keys(match.performances).length).toBeGreaterThanOrEqual(22);
      expect(match.events.some((event) => event.type === 'pass')).toBe(true);
      // The scoreline adds up to the goal events, however they arose.
      const goals = match.events.filter(
        (event) => event.type === 'goal' || event.type === 'own-goal' || event.type === 'penalty-scored',
      ).length;
      expect(goals).toBe(result!.homeGoals + result!.awayGoals);
    }
  }, 120_000);
});
