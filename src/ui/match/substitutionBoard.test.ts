import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isPlayer, type Player } from '@/domain/person';
import { diagramFraction, diagramPosition } from '../tacticalDiagram';
import { lineupShape } from '../lineupEditing';
import { createTestGame } from '@/simulation/testSupport';
import { prepareMatchday } from '@/simulation/matchday';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import type { Side } from '@/domain/matchState';
import type { MatchSession } from '@/state/gameStore';
import { SubstitutionBoard, shirtIndexAt } from './SubstitutionBoard';

/**
 * The board is the matchday version of the team sheet, so what is checked here
 * is what can be checked without a browser: the eleven and the bench are both on
 * it, the rules that stop a change are the rules the store and the engine
 * enforce, a drop lands on the shirt the manager aimed at, and the two changes
 * the screen can make are the two the store has.
 */

const sheet = readFileSync('src/ui/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const source = readFileSync('src/ui/match/SubstitutionBoard.tsx', 'utf8');

function scene(seed: string, phase: MatchSession['phase'] = 'in-progress') {
  const { state } = createTestGame(seed);
  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
  )!;
  prepareMatchday(state, fixture.matchday);
  const match: Match = state.matches[fixture.id]!;
  const side: Side = match.homeClubId === state.userClubId ? 'home' : 'away';
  const session = { side, phase } as MatchSession;
  const playerById = (id: string): Player | undefined => {
    const person = (state as GameState).people[id];
    return isPlayer(person) ? person : undefined;
  };
  return { state, match, side, session, playerById };
}

type Scene = ReturnType<typeof scene>;

function board(taken: Scene) {
  return renderToStaticMarkup(
    createElement(SubstitutionBoard, { match: taken.match, session: taken.session, playerById: taken.playerById }),
  );
}

describe('the substitution board', () => {
  it('puts the eleven on the pitch and the bench beside them', () => {
    const taken = scene('subboard-shape');
    const { match, side, playerById } = taken;
    const lineup = match.lineups[side];
    const html = board(taken);

    expect(lineup.starting).toHaveLength(11);
    expect(html.match(/class="pitch__player subboard__shirt/g)).toHaveLength(11);
    // One button per substitute, and each one says which man it is, because the
    // drop is matched by the element's own id.
    for (const slot of lineup.bench) {
      expect(html).toContain(`data-player-id="${slot.playerId}"`);
      const player = playerById(slot.playerId)!;
      expect(html).toContain(player.surname);
    }
    // The pitch is the one the eleven are already standing on: a dot per starter,
    // placed by the same shape the team sheet draws.
    const shape = lineupShape(lineup);
    const placed = diagramFraction(diagramPosition(shape[0]!));
    expect(html).toContain(`--shape-left:${placed.left * 100}%`);
  });

  it('counts the changes the manager has left, in the engine’s own allowance', () => {
    const taken = scene('subboard-count');
    const { match, side } = taken;
    const html = board(taken);
    expect(html).toContain('3 changes left.');
    expect(match.substitutions[side]).toBe(0);

    match.substitutions[side] = 2;
    expect(board(taken)).toContain('1 change left.');

    // Spent: the board stays on screen and read, and stops being a set of
    // controls — which is what the engine would do with a fourth change.
    match.substitutions[side] = 3;
    const spent = board(taken);
    expect(spent).toContain('All three changes used.');
    expect(spent.match(/disabled=""/g)!.length).toBeGreaterThanOrEqual(11 + match.lineups[side].bench.length);
  });

  it('is selection before kick-off rather than a substitution', () => {
    const taken = scene('subboard-prematch', 'pre-match');
    const { match, side } = taken;
    const html = board(taken);
    expect(html).toContain('Before kick-off this is selection');
    // Nothing is spent yet, and nothing is disabled: changing the XI before the
    // whistle is picking the team.
    expect(match.substitutions[side]).toBe(0);
    expect(html).not.toContain('disabled=""');
  });

  it('does not offer a shirt the engine would refuse to fill', () => {
    const taken = scene('subboard-sent-off');
    const { match, side } = taken;
    const slot = match.lineups[side].starting[4]!;
    // One man's afternoon, in the shape the record keeps it — a booking and a
    // red, which is the state the board has to read before it offers his shirt.
    match.performances[slot.playerId] = {
      playerId: slot.playerId,
      clubId: match.lineups[side].clubId,
      started: true,
      minutesPlayed: 62,
      positionPlayed: slot.position,
      goals: 0,
      assists: 0,
      shots: 0,
      shotsOnTarget: 0,
      passes: 20,
      passesCompleted: 15,
      tackles: 2,
      interceptions: 1,
      saves: 0,
      fouls: 2,
      yellowCards: 1,
      redCards: 1,
      rating: 5.4,
      cameOnMinute: null,
      wentOffMinute: 62,
      energy: 55,
      injuryDetail: null,
      sentOff: true,
    };
    const html = board(taken);
    // A man who has been sent off is off, and nobody replaces him.
    expect(html).toContain('was sent off; nobody replaces him.');
    expect(html.match(/disabled=""/g)).toHaveLength(1);
  });

  it('makes the change the store can make, in the phase the match is in', () => {
    // The board's two ends are the store's two calls, and the game is never told
    // about a change any other way: a substitution during the match, a selection
    // swap before it.
    expect(source).toContain('gameActions().makeSubstitution(outgoingId, incomingId)');
    expect(source).toContain('gameActions().swapSessionPlayers(outgoingId, incomingId)');
    expect(source).toContain('if (preMatch) gameActions().swapSessionPlayers');
    // It reads the lineup the engine plays from, so a man who has just come on is
    // off the bench on the next paint rather than on the next screen.
    expect(source).toContain('match.lineups[session.side]');
    expect(source).toContain('match.substitutions[session.side] >= 3');
  });

  it('is dragged with the pointer, and is a button when it is not', () => {
    // Both ways in: a press that moves is a drag, a press that does not is a pick
    // — and every control is a button, so the keyboard does the same thing.
    expect(source).toContain('setPointerCapture');
    expect(source).toContain('onPointerDown');
    expect(source).toContain('onPointerUp');
    expect(source).toContain('aria-pressed={picked}');
    // The two ends of a change are the two halves of the board.
    expect(source).toContain('subboard__sub');
    expect(source).toContain('subboard__shirt--target');
    expect(sheet).toMatch(/\.subboard__sub \{[\s\S]*?touch-action: none;/);
    expect(sheet).toMatch(/\.subboard__shirt--target \{[\s\S]*?outline: 3px solid var\(--accent\)/);
  });

  it('matches a drop to the shirt drawn nearest the pointer, not to the grass', () => {
    const { match, side } = scene('subboard-drop');
    const lineup = match.lineups[side];
    const shape = lineupShape(lineup).slice(0, lineup.starting.length);
    const box = { left: 0, top: 0, width: 800, height: 450 };

    // A pointer exactly on a man's shirt is that man, for every man.
    for (let index = 0; index < shape.length; index += 1) {
      const drawn = diagramFraction(diagramPosition(shape[index]!));
      expect(shirtIndexAt(shape, box, drawn.left * box.width, drawn.top * box.height)).toBe(index);
    }

    // Between the shirts there is grass, and a drop on it is not a change: some
    // of the pitch has to be a miss, or every drag would take a man off.
    const hits = new Set<number>();
    let misses = 0;
    for (let across = 0; across <= 20; across += 1) {
      for (let depth = 0; depth <= 20; depth += 1) {
        const index = shirtIndexAt(shape, box, (across / 20) * box.width, (depth / 20) * box.height);
        if (index === null) misses += 1;
        else hits.add(index);
      }
    }
    expect(misses).toBeGreaterThan(0);
    // And every shirt on the pitch can be aimed at, keeper included.
    expect(hits.size).toBe(shape.length);

    // A pointer off the board entirely takes nothing off it.
    expect(shirtIndexAt(shape, box, -400, 900)).toBeNull();
    expect(shirtIndexAt(shape, box, box.width * 3, box.height / 2)).toBeNull();
  });
});
