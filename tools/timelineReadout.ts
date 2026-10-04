/**
 * What the engine said, and how the presentation would spend it.
 *
 * The match engine writes one authoritative stream of events, each stamped with
 * the second of football it happened on. The presentation layer reads that
 * stream as passages and decides how much real time each one is worth. Both
 * halves of the split are invisible from the pitch: a passage that lasts eight
 * seconds of football might be four seconds of screen or a tenth of one, and
 * there is no way to tell from watching whether the pacing is doing what it was
 * meant to.
 *
 * This prints both, side by side, for one match:
 *
 *   npm run timeline-readout
 *   npm run timeline-readout -- --seed=riverbank --importances
 *
 *  - **The clock.** Every event, at its second, exactly as the engine wrote it —
 *    the dev readout the brief asks for, not exposed to players.
 *  - **The passages.** How the flat stream is grouped into the moves a manager
 *    would recognise, with the attacking side, the loudest event and what each
 *    came to.
 *  - **The pacing.** For every viewing mode: how long the match would take to
 *    watch, and how much of that is the football rather than the filler. This is
 *    the measurement that proves simulation speed and presentation speed are
 *    independent — the same record, five different afternoon lengths.
 *  - **The budget.** How long the *simulation* took, against how long watching it
 *    would take. A ninety-minute match must be simulable in seconds, and this is
 *    the number that says whether it is.
 *
 * It is a developer tool. Nothing in the game imports it, it is outside the test
 * suite, and it is typechecked with everything else so it cannot rot.
 */

import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { createMatchEngine } from '@/simulation/match/matchEngine';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { nextMatchday } from '@/simulation/timeline';
import { createTestGame } from '@/simulation/testSupport';
import { buildTimeline, highlightPassages, type MatchPassage } from '@/presentation/matchTimeline';
import { estimatedWatchSeconds, VIEWING_MODES, VIEWING_MODE_LABEL } from '@/presentation/matchPlayback';

interface Options {
  seed: string;
  passages: boolean;
  events: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { seed: 'timeline', passages: true, events: true };
  for (const arg of argv) {
    const [name, value] = arg.replace(/^--/, '').split('=');
    switch (name) {
      case 'seed':
        options.seed = (value ?? '').trim() || 'timeline';
        break;
      case 'no-passages':
        options.passages = false;
        break;
      case 'no-events':
        options.events = false;
        break;
      default:
        break;
    }
  }
  return options;
}

/** The human's own fixture, with its lineups prepared, played by the engine. */
function playMatch(seed: string): {
  state: GameState;
  match: Match;
  elapsedMs: number;
  stopped: { first: number; second: number };
} {
  const { state } = createTestGame(seed);
  const matchday = nextMatchday(state);
  const fixture = Object.values(state.matches).find(
    (candidate) =>
      candidate.matchday === matchday &&
      (candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId),
  );
  if (!fixture) throw new Error('the test game has no fixture on the next matchday');
  prepareMatchday(state, fixture.matchday);
  const match = state.matches[fixture.id]!;

  // The simulation, and only the simulation: no renderer, no presentation, no
  // frame loop. The wall clock around it is the whole point of the measurement.
  const started = performance.now();
  const engine = createMatchEngine(match, matchEnvironment(state, match, { autoManageAllBenches: true }));
  engine.runToCompletion();
  const elapsedMs = performance.now() - started;
  return { state, match, elapsedMs, stopped: engine.getState().stoppedSeconds };
}

/** `72:31` — the engine's own second, at the resolution the presentation uses. */
function clock(second: number): string {
  const whole = Math.max(0, Math.floor(second));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${String(minutes).padStart(3, ' ')}:${String(seconds).padStart(2, '0')}`;
}

function seconds(total: number): string {
  const whole = Math.round(total);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return minutes > 0 ? `${minutes}m ${String(rest).padStart(2, '0')}s` : `${rest}s`;
}

function heading(text: string): string {
  return `\n── ${text} ${'─'.repeat(Math.max(0, 68 - text.length))}`;
}

function sideName(state: GameState, match: Match, passage: MatchPassage): string {
  if (passage.side === 'home') return state.clubs[match.homeClubId]!.identity.shortName;
  if (passage.side === 'away') return state.clubs[match.awayClubId]!.identity.shortName;
  return '—';
}

function report(
  state: GameState,
  match: Match,
  elapsedMs: number,
  stopped: { first: number; second: number },
  options: Options,
): void {
  const timeline = buildTimeline(match.events, match);

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('  TIMELINE READOUT — the engine’s record, and how it would be watched');
  console.log('══════════════════════════════════════════════════════════════════════');
  const home = state.clubs[match.homeClubId]!.identity.name;
  const away = state.clubs[match.awayClubId]!.identity.name;
  const result = match.result;
  console.log(`   ${home} ${result?.homeGoals ?? 0}–${result?.awayGoals ?? 0} ${away}`);
  console.log(
    `   events ${match.events.length}   passages ${timeline.passages.length}   ` +
      `football ${clock(timeline.durationSeconds)}`,
  );
  // Added time is measured from the stoppages the engine actually saw, so show
  // both: the dead seconds, and the minutes they came to.
  console.log(
    `   added time   +${match.stoppage?.first ?? 0} (${Math.round(stopped.first)}s dead)   ` +
      `+${match.stoppage?.second ?? 0} (${Math.round(stopped.second)}s dead)`,
  );

  console.log(heading('THE BUDGET — simulation against watching'));
  console.log(`   simulation took        ${(elapsedMs / 1000).toFixed(2)}s of real time`);
  for (const mode of VIEWING_MODES) {
    const watch = estimatedWatchSeconds(timeline, mode);
    console.log(
      `   watched as ${VIEWING_MODE_LABEL[mode].padEnd(13)} ${seconds(watch).padStart(9)}` +
        `   (${(timeline.durationSeconds / Math.max(1, watch)).toFixed(1)}× real time)`,
    );
  }
  console.log(`   ratio sim/watching     ${(elapsedMs / 1000 / Math.max(0.001, estimatedWatchSeconds(timeline, 'full'))).toFixed(4)}`);

  if (options.events) {
    console.log(heading('THE EVENT STREAM — the engine’s own account'));
    for (const event of match.events) {
      const second = event.second ?? event.minute * 60;
      const who = state.people[event.playerId ?? ''] as { surname?: string } | undefined;
      console.log(
        `   ${clock(second)}  ${event.type.padEnd(15)} ${(who?.surname ?? '').padEnd(12)} ${event.text}`,
      );
    }
  }

  if (options.passages) {
    console.log(heading('THE PASSAGES — the same record, grouped to watch'));
    for (const passage of timeline.passages) {
      const length = Math.round(Math.max(0, passage.endSecond - passage.startSecond));
      console.log(
        `   p${String(passage.index + 1).padStart(2, '0')} ` +
          `${clock(passage.startSecond)}–${clock(passage.endSecond)} ` +
          `imp ${passage.importance}  ${passage.outcome.padEnd(9)} ` +
          `${sideName(state, match, passage).padEnd(14)} ${String(length).padStart(3)}s  ` +
          `${passage.events.length} event${passage.events.length === 1 ? '' : 's'}`,
      );
    }

    console.log(heading('KEY MOMENTS — what a highlights package would keep'));
    const key = highlightPassages(timeline, 3);
    if (key.length === 0) console.log('   none — a goalless, chanceless afternoon');
    for (const passage of key) {
      const cause = passage.events.find((event) => event.id === passage.keyEventId);
      console.log(
        `   ${clock(passage.startSecond)}  ${sideName(state, match, passage).padEnd(14)} ` +
          `${cause?.type ?? passage.outcome}  ${cause?.text ?? ''}`,
      );
    }
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const { state, match, elapsedMs, stopped } = playMatch(options.seed);
  report(state, match, elapsedMs, stopped, options);
}

main();
