import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Match } from '@/domain/match';
import { POSITIONS, type FormationSlot } from '@/domain/positions';
import type { Player } from '@/domain/person';
import type { MatchSession } from '@/state/gameStore';
import { gameActions } from '../hooks';
import { lineupShape } from '../lineupEditing';
import { diagramPosition, diagramStyle, nearestDrawnSlot, onShirt, pitchPointerFraction } from '../tacticalDiagram';

/**
 * The bench, on the pitch it is coming on to.
 *
 * Making a change used to be a list of five dropdowns: pick the man coming off
 * in a select, six rows down from the man coming on, with the shape nowhere on
 * screen. A manager making a change has one picture in his head — who is tiring
 * where — and a dropdown cannot hold it. The board can: the eleven stand in their
 * shape, the bench sits beside them, and the change is the two of them meeting.
 *
 * It draws the same pitch `TeamSelectionView` drags players around on and reads
 * the same `lineupShape`, so the shirt a manager drops a substitute on is in the
 * place he last saw him, not in the formation's default. The football is the
 * store's: before kick-off a swap is selection (`swapSessionPlayers`, which
 * spends nothing) and during the match it is a substitution
 * (`makeSubstitution`, three of them). Nothing here decides either.
 *
 * Every control is a button, so a thumb can drag and a keyboard can pick up and
 * put down, and both make the same change.
 */

/** How far the pointer has to travel before a press is a drag and not a click. */
const DRAG_THRESHOLD = 5;

/**
 * What is in the manager's hand: the shirt he has picked up, or the substitute
 * he is bringing on. Holding one of them is the whole of the interaction — the
 * other end of it is where he puts it down.
 */
type Held = { kind: 'bench'; playerId: string } | { kind: 'slot'; index: number };

/**
 * The shirt a pointer is over, in the space the shirts are actually drawn in.
 *
 * The drop is matched where the manager is looking rather than by the football
 * position under his finger, which is the same reading `TeamSelectionView` makes
 * and for the same reason: a dot is drawn to the side of the point it stands on,
 * and the keeper's line is not a row of the pitch grid at all.
 */
export function shirtIndexAt(
  shape: readonly FormationSlot[],
  box: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): number | null {
  const under = nearestDrawnSlot(pitchPointerFraction(box, clientX, clientY), shape);
  return onShirt(under) ? under.index : null;
}

export function SubstitutionBoard({
  match,
  session,
  playerById,
}: {
  match: Match;
  session: MatchSession;
  playerById: (id: string) => Player | undefined;
}) {
  const lineup = match.lineups[session.side];
  const shape = lineupShape(lineup).slice(0, lineup.starting.length);
  const preMatch = session.phase === 'pre-match';
  const frozen = session.phase === 'full-time';
  const spent = !preMatch && match.substitutions[session.side] >= 3;
  const stopped = frozen || spent;

  const [held, setHeld] = useState<Held | null>(null);
  const [overSlot, setOverSlot] = useState<number | null>(null);
  const [overSub, setOverSub] = useState<string | null>(null);
  const [said, setSaid] = useState('');

  const pitchRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  /** The press that just picked something up: its own click is not a second act. */
  const pickedRef = useRef<EventTarget | null>(null);
  const suppressClickRef = useRef(false);

  // Escape puts the man in hand back on the bench, wherever the pointer is.
  useEffect(() => {
    if (!held) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHeld(null);
        setOverSlot(null);
        setOverSub(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [held]);

  const name = (id: string) => playerById(id)?.surname ?? 'Unknown';
  const energyOf = (id: string) => Math.round(match.performances[id]?.energy ?? playerById(id)?.fitness ?? 0);

  /** The change itself, in whichever of the two forms the match is in. */
  const commit = (outgoingId: string, incomingId: string) => {
    if (outgoingId === incomingId) return;
    const incoming = playerById(incomingId);
    const outgoing = playerById(outgoingId);
    if (!incoming || !outgoing) return;
    if (preMatch) gameActions().swapSessionPlayers(outgoingId, incomingId);
    else gameActions().makeSubstitution(outgoingId, incomingId);
    setSaid(
      preMatch
        ? `${incoming.surname} takes the shirt from ${outgoing.surname}.`
        : `${incoming.surname} comes on for ${outgoing.surname}.`,
    );
    setHeld(null);
    setOverSlot(null);
    setOverSub(null);
  };

  /** The shirt under the pointer, read where the shirts are drawn. */
  const shirtUnder = (clientX: number, clientY: number) => {
    const box = pitchRef.current?.getBoundingClientRect();
    return box ? shirtIndexAt(shape, box, clientX, clientY) : null;
  };

  /** What was just picked up, said out loud: a press that changes nothing yet. */
  const announcePick = (next: Held) => {
    setSaid(
      next.kind === 'bench'
        ? `${name(next.playerId)} is ready. Press the man he replaces.`
        : `${name(lineup.starting[next.index]?.playerId ?? '')} — press the substitute coming on for him.`,
    );
  };

  const pick = (event: ReactPointerEvent<HTMLElement>, next: Held) => {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* the pointer is already gone; the plain move events still work */
    }
    movedRef.current = false;
    suppressClickRef.current = false;
    pickedRef.current = event.currentTarget;
    originRef.current = { x: event.clientX, y: event.clientY };
    setHeld(next);
    announcePick(next);
  };

  const onMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!held) return;
    const origin = originRef.current;
    if (origin && !movedRef.current) {
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < DRAG_THRESHOLD) return;
      movedRef.current = true;
      pickedRef.current = null;
    }
    if (held.kind === 'bench') {
      setOverSlot(shirtUnder(event.clientX, event.clientY));
      setOverSub(null);
    } else {
      const chip = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.subboard__sub');
      setOverSub(chip?.dataset.playerId ?? null);
      setOverSlot(null);
    }
  };

  const onDrop = (event: ReactPointerEvent<HTMLElement>) => {
    const state = held;
    setOverSlot(null);
    setOverSub(null);
    originRef.current = null;
    if (!state || !movedRef.current) return;
    movedRef.current = false;
    // The pointer moved: the click that follows is this drag's, not a pick.
    suppressClickRef.current = true;
    if (state.kind === 'bench') {
      const index = shirtUnder(event.clientX, event.clientY);
      const slot = index === null ? undefined : lineup.starting[index];
      if (slot) commit(slot.playerId, state.playerId);
      else setHeld(null);
      return;
    }
    const chip = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.subboard__sub');
    const arriving = chip?.dataset.playerId;
    const slot = lineup.starting[state.index];
    if (arriving && slot) commit(slot.playerId, arriving);
    else setHeld(null);
  };

  const cancel = () => {
    setHeld(null);
    setOverSlot(null);
    setOverSub(null);
    originRef.current = null;
    movedRef.current = false;
  };

  /**
   * Whether this click is the tail of something already handled.
   *
   * A press that picked a man up, and a drag that just made a change, both end
   * in a click on the same button — and neither of them is a second act.
   */
  const clickIsOurs = (target: EventTarget) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return true;
    }
    if (pickedRef.current === target) {
      pickedRef.current = null;
      return true;
    }
    return false;
  };

  const changesLeft = 3 - match.substitutions[session.side];

  return (
    <div className="subboard">
      <div className="subboard__board">
        <div
          className="pitch pitch--static pitch--preparation subboard__pitch"
          ref={pitchRef}
          data-holding={held?.kind === 'bench' ? 'true' : undefined}
        >
          <span className="pitch__halfway" />
          <span className="pitch__circle" />
          <span className="pitch__box pitch__box--left" />
          <span className="pitch__box pitch__box--right" />
          {lineup.starting.map((slot, index) => {
            const player = playerById(slot.playerId);
            const energy = energyOf(slot.playerId);
            const performance = match.performances[slot.playerId];
            const picked = held?.kind === 'slot' && held.index === index;
            // A sent-off man cannot be replaced: he is off, and his side plays a
            // man short, so his shirt is not offered as somewhere to come on to
            // — the engine would refuse the change the moment it was made.
            const sentOff = Boolean(performance?.redCards);
            return (
              <button
                key={`${slot.playerId}-${index}`}
                type="button"
                className={`pitch__player subboard__shirt${picked ? ' subboard__shirt--held' : ''}${
                  overSlot === index ? ' subboard__shirt--target' : ''
                }${slot.outOfPosition ? ' pitch__player--oops' : ''}`}
                style={diagramStyle(diagramPosition(shape[index] ?? shape[0]!))}
                aria-pressed={picked}
                disabled={stopped || sentOff}
                title={
                  sentOff
                    ? `${player?.surname ?? 'He'} was sent off; nobody replaces him.`
                    : player
                      ? `${player.surname} — ${POSITIONS[slot.position].label} · energy ${energy}${
                          held?.kind === 'bench' ? ` · press to bring ${name(held.playerId)} on for him` : ''
                        }`
                      : 'Empty shirt'
                }
                onPointerDown={(event) => {
                  if (held) return;
                  pick(event, { kind: 'slot', index });
                }}
                onPointerMove={onMove}
                onPointerUp={onDrop}
                onPointerCancel={cancel}
                onClick={(event) => {
                  if (clickIsOurs(event.currentTarget)) return;
                  if (held?.kind === 'bench') {
                    commit(slot.playerId, held.playerId);
                    return;
                  }
                  if (held?.kind === 'slot' && held.index === index) {
                    setHeld(null);
                    setSaid('');
                    return;
                  }
                  const next = { kind: 'slot' as const, index };
                  setHeld(next);
                  setSaid(
                    `${energy <= 45 ? 'Tiring' : 'On the pitch'}: ${player?.surname ?? 'that shirt'}. Press the substitute coming on.`,
                  );
                }}
              >
                <span className="pitch__shirt">{slot.position}</span>
                <span className="pitch__name">
                  {player ? player.surname : 'Empty'}
                  {performance?.yellowCards ? <span className="cards cards--yellow" title="Booked" /> : null}
                  {performance?.redCards ? <span className="cards cards--red" title="Sent off" /> : null}
                </span>
                <span className={`subboard__fuel${energy < 35 ? ' subboard__fuel--low' : energy < 60 ? ' subboard__fuel--worn' : ''}`}>
                  {energy}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="subboard__bench">
        <h4 className="subhead">
          Substitutes <span className="muted small">({lineup.bench.length})</span>
        </h4>
        <ul className="subboard__list">
          {lineup.bench.map((slot) => {
            const player = playerById(slot.playerId);
            const energy = energyOf(slot.playerId);
            const used = Boolean(match.performances[slot.playerId]?.minutesPlayed);
            const picked = held?.kind === 'bench' && held.playerId === slot.playerId;
            return (
              <li key={slot.playerId}>
                <button
                  type="button"
                  className={`subboard__sub${picked ? ' subboard__sub--held' : ''}${
                    overSub === slot.playerId ? ' subboard__sub--target' : ''
                  }${used ? ' subboard__sub--used' : ''}`}
                  data-player-id={slot.playerId}
                  aria-pressed={picked}
                  disabled={stopped || used}
                  onPointerDown={(event) => {
                    if (held || used || stopped) return;
                    pick(event, { kind: 'bench', playerId: slot.playerId });
                  }}
                  onPointerMove={onMove}
                  onPointerUp={onDrop}
                  onPointerCancel={cancel}
                  onClick={(event) => {
                    if (clickIsOurs(event.currentTarget)) return;
                    if (held?.kind === 'slot') {
                      const slot2 = lineup.starting[held.index];
                      if (slot2) {
                        commit(slot2.playerId, slot.playerId);
                        return;
                      }
                    }
                    // Pressing the man already in hand puts him back, the way
                    // pressing the shirt in hand does. A second press is how a
                    // pick-up is undone, on a board with no way to drop him.
                    if (held?.kind === 'bench' && held.playerId === slot.playerId) {
                      setHeld(null);
                      setSaid('');
                      return;
                    }
                    const next = { kind: 'bench' as const, playerId: slot.playerId };
                    setHeld(next);
                    announcePick(next);
                  }}
                  title={
                    player
                      ? `${player.surname} — ${POSITIONS[slot.position].label} · energy ${energy}${
                          used ? ' · already used' : ' · drag him onto a shirt to bring him on'
                        }`
                      : undefined
                  }
                >
                  <span className="subboard__sub-shift">{POSITIONS[slot.position].code}</span>
                  <span className="subboard__sub-who">{player ? `${player.firstName.charAt(0)}. ${player.surname}` : 'Unknown'}</span>
                  <span
                    className={`subboard__fuel${energy < 35 ? ' subboard__fuel--low' : energy < 60 ? ' subboard__fuel--worn' : ''}`}
                  >
                    {energy}
                  </span>
                </button>
              </li>
            );
          })}
          {lineup.bench.length === 0 && <li className="subboard__none small muted">Nobody on the bench.</li>}
        </ul>
        <p className="drawer-note small muted">
          {frozen
            ? 'The match is over.'
            : preMatch
              ? 'Before kick-off this is selection: swapping a man changes today’s XI and spends nothing.'
              : spent
                ? 'All three changes used.'
                : `${changesLeft} change${changesLeft === 1 ? '' : 's'} left. Drag a substitute onto a shirt, or press one and then the other.`}
        </p>
      </div>

      <p className="visually-hidden" role="status">
        {said}
      </p>
    </div>
  );
}
