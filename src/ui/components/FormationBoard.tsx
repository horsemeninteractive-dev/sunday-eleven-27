import type { GameState } from '@/domain/game';
import type { LineupSlot } from '@/domain/match';
import { getFormation, type FormationId } from '@/domain/positions';
import { isPlayer } from '@/domain/person';
import { LINE_LABEL, PRESSING_LABEL, type Tactics } from '@/domain/tactics';
import { diagramPosition, diagramStyle, type DiagramPhase } from '../tacticalDiagram';
import { flatClubInk } from '../colour';
import { goalkeeperKitColour } from '../kit';

import { PersonLine } from './PersonIdentity';

/**
 * The shape, drawn.
 *
 * One picture, one control. The phase is handed in by the screen rather than
 * chosen here, because the screen is where the manager already switched between
 * his shape, what he does with the ball and what he does without it — and a
 * second set of tabs inside the picture, with the same three names on it, was
 * two controls for one idea.
 *
 * It is a diagram of the instructions, never a source of truth about a match:
 * `TOUCHLINE_ARCHITECTURE.md` says the simulation decides where a man stands
 * during a game, and this is a drawing of what the manager has asked for before
 * one starts. The caption says so, in the manager's own terms.
 */
export function FormationBoard({
  game,
  formation,
  slots = [],
  tactics,
  phase = 'shape',
}: {
  game: GameState;
  formation: FormationId;
  slots?: LineupSlot[];
  tactics?: Tactics;
  phase?: DiagramPhase;
}) {
  const shape = getFormation(formation);
  const illustrated = Boolean(tactics) && phase !== 'shape';
  // The keeper's shirt, which is not the club's.
  //
  // The board draws the same third strip the pitch and the portrait draw, so the
  // one dot on the diagram that is not in the club's colours is the man in goal.
  // A shirt is a flat colour here rather than the shaded one the ten wear: the
  // club's colour is never a fade in this game, and a keeper the manager can
  // pick out at a glance is the whole point of the strip.
  const keeperShirt = goalkeeperKitColour(game, game.userClubId);
  const keeperStyle = keeperShirt
    ? { background: keeperShirt, color: flatClubInk(keeperShirt) }
    : undefined;
  return (
    <div className="formation-board">
      <div
        className="pitch pitch--static pitch--preparation"
        role="img"
        aria-label={`${formation} ${phase === 'shape' ? 'starting shape' : phase === 'with-ball' ? 'shape with the ball' : 'shape without the ball'}; selected players listed below`}
      >
        <span className="pitch__halfway" />
        <span className="pitch__circle" />
        <span className="pitch__box pitch__box--left" />
        <span className="pitch__box pitch__box--right" />
        <span className="pitch__direction" aria-hidden="true">↑ Attacking</span>
        {shape.slots.map((slot, index) => {
          const selected = slots[index];
          const player = selected ? game.people[selected.playerId] : undefined;
          const name = isPlayer(player) ? player.surname : null;
          return (
            <div
              className={`pitch__player formation-board__player${selected?.outOfPosition ? ' pitch__player--oops' : ''}`}
              key={index}
              style={diagramStyle(diagramPosition(slot, tactics, phase))}
            >
              <span
                className={`pitch__shirt${slot.position === 'GK' ? ' pitch__shirt--keeper' : ''}`}
                style={slot.position === 'GK' ? keeperStyle : undefined}
              >
                {slot.position}
              </span>
              {/* The shirt already says the position. A second copy underneath
                  it was noise on every unselected slot, so the label is the
                  player's name or nothing at all. */}
              {name && <span className="pitch__name">{name}</span>}
            </div>
          );
        })}
      </div>
      <p className="small muted">
        {illustrated
          ? `Illustrative shape, not a prediction: a ${LINE_LABEL[tactics!.defensiveLine].toLowerCase()} line and ${PRESSING_LABEL[
              tactics!.pressing
            ].toLowerCase()}. Touchline decides where players actually stand, once the ball is moving.`
          : shape.description}
      </p>
      {slots.length > 0 && (
        <details className="more">
          <summary>Players in this shape</summary>
          <ul className="tight-list">
            {slots.map((slot, index) => (
              <li key={index} className="row">
                <span className="muted small">{slot.position}</span>

                {/* The board draws a man by where he stands and by the shirt he
                    is wearing. This list is the readable version of the same
                    eleven, and a list of men in this game is drawn. */}
                <PersonLine personId={slot.playerId} />
                {slot.outOfPosition && <span className="tone tone--warn small">Out of position</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
