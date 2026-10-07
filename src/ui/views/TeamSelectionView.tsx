import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
} from 'react';
import type { BenchSlot, LineupSlot, MatchLineup } from '@/domain/match';
import { isPlayer, type Player } from '@/domain/person';
import {
  FORMATION_IDS,
  POSITIONS,
  getFormation,
  isNamedShape,
  positionForPoint,
  type FormationId,
  type FormationSlot,
  type PositionCode,
} from '@/domain/positions';
import { autoPickLineup, positionScore, validateLineup } from '@/simulation/selection';
import { availabilityTone, playerName } from '../format';
import { gameActions, useGame, useNextFixture, useSquad } from '../hooks';
import { Button, Meter, PageHeader, Panel, Pill } from '../components/primitives';
import { PlayerLink } from '../components/Links';
import { Glyph, UIGlyph } from '../components/icons';
import { diagramFraction, diagramPosition, diagramStyle, pitchPointAt } from '../tacticalDiagram';
import {
  applyFormation,
  applyShape,
  assignToBench,
  clearShape,
  clearSlot,
  lineupShape,
  moveSlot,
  placeInSlot,
  removeFromBench,
  replaceOnBench,
  setCaptain,
  swapWithBench,
} from '../lineupEditing';

type PickerTarget = { kind: 'starting'; index: number } | { kind: 'bench' };

/**
 * Something is in the manager's hand: a dot he has picked up, or a man he has
 * picked up to put on a dot. `ghost` is where it is being held, in the pitch's
 * own coordinates, and `pointer` is where the finger is, for the chip.
 */
type DragState =
  | { kind: 'slot'; index: number; ghost: { x: number; y: number } | null; pointer: { x: number; y: number } | null }
  | {
      kind: 'player';
      playerId: string;
      from: 'squad' | 'bench';
      ghost: { x: number; y: number } | null;
      pointer: { x: number; y: number } | null;
    };

/**
 * How far one arrow key moves a dot: across the pitch for left and right, up and
 * down the pitch for forward and back. The two are different sizes because the
 * picture stretches the pitch across, so equal steps would look unequal.
 */
const STEP_DEPTH = 0.05;
const STEP_ACROSS = 0.07;

/** How far the pointer has to travel before it is a drag and not a click. */
const DRAG_THRESHOLD = 5;

/**
 * Anything the pointer can press *instead of* dragging: a control with a job of
 * its own.
 *
 * A name is deliberately not one of them. A name is a button that opens the
 * man's page, but it is also a man, and a man is the thing a manager picks up in
 * a team sheet — refusing to drag him by his own name was the difference between
 * "drag a player from the squad list" and "drag the five pixels beside his name".
 * A click that never moved still opens his page; a press that moved is a drag,
 * and the click that follows it is dropped before the name can act on it.
 */
const CONTROLS = 'button:not(.playerlink), input, select, summary';

/**
 * Picking the side.
 *
 * The screen is one workspace that fits the window rather than a page that
 * scrolls, because picking a team is done with the eyes on the pitch: the squad
 * on the right, the shape on the left, and the pitch in the middle, all of them
 * visible at once. Nothing important is below the fold, so nothing important
 * scrolls away while a man is being moved; the two long lists scroll inside
 * their own panes, the way a table does.
 *
 * The pitch is the manager's. A dot can be dragged anywhere on it and the
 * *position* becomes the one that zone is for, because a Sunday side has eleven
 * jobs and the game knows what they are; a man can be dragged out of the squad
 * list or off the bench onto a shirt; and the shape that results can be kept
 * under a name and set out again next week. The squad list is the whole squad,
 * always, with where each man currently is written next to him.
 */
export function TeamSelectionView() {
  const game = useGame();
  const squad = useSquad();
  const fixture = useNextFixture();
  const [target, setTarget] = useState<PickerTarget | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [overBench, setOverBench] = useState(false);
  // On a phone the squad list is a sheet rather than a column, so it is asked
  // for as well as targeted: picking a shirt slides it in, and it can also be
  // wanted on its own.
  const [listOpen, setListOpen] = useState(false);
  const [shapeName, setShapeName] = useState('');
  // The two small controls that belong on the pitch itself rather than in a
  // column beside it, and the box each of them opens over the grass: a shape is
  // kept from the pitch it was drawn on, and the selection's problems are asked
  // for rather than kept on the screen.
  const [pitchPanel, setPitchPanel] = useState<'shape' | 'warnings' | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const pitchRef = useRef<HTMLDivElement>(null);
  const movedRef = useRef(false);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  // A shirt has been picked, so the answer is in the list beside the pitch: the
  // keyboard goes there. It never scrolls the pitch out of the window, because
  // on this screen the pitch is where the manager is looking.
  useEffect(() => {
    // Only a sheet takes the focus. On a desktop the list is already on the
    // screen, and moving the keyboard into it would take it away from the dot
    // the manager is working with.
    if (!target && !listOpen) return;
    if (!window.matchMedia('(max-width: 859px)').matches) return;
    pickerRef.current?.focus({ preventScroll: true });
  }, [target, listOpen]);

  // Escape puts either box on the pitch away, wherever the manager's hands are:
  // the box is over the grass rather than a modal, so there is no layer for the
  // key to have to reach first.
  useEffect(() => {
    if (!pitchPanel) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setPitchPanel(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pitchPanel]);

  if (!game) return null;
  if (!fixture) {
    return (
      <div className="team-selection">
        <PageHeader eyebrow="Team" title="Team selection" />
        <Panel>
          <p className="empty">There is nothing to pick a team for. No fixture is scheduled.</p>
        </Panel>
      </div>
    );
  }

  const clubId = game.userClubId;
  const isHome = fixture.homeClubId === clubId;
  const lineup: MatchLineup = isHome ? fixture.lineups.home : fixture.lineups.away;
  const clubTactics = game.clubs[clubId]!.tactics;
  const players = (id: string) => {
    const person = game.people[id];
    return isPlayer(person) ? person : undefined;
  };
  const problems = validateLineup(lineup.starting, lineup.bench, players);
  const errors = problems.filter((problem) => problem.severity === 'error');
  const warnings = problems.filter((problem) => problem.severity !== 'error');
  const shape = lineupShape(lineup);
  const savedShape = lineup.tactics.shapeId
    ? game.customFormations.find((entry) => entry.id === lineup.tactics.shapeId)
    : undefined;
  // "Edited" is a comparison rather than a flag, so a shape that has been put
  // back exactly as it was saved stops claiming to have been changed.
  const handMade = Boolean(lineup.tactics.shape) && !isNamedShape(lineup.tactics.formation, lineup.tactics.shape);
  const shapeLabel = savedShape
    ? `${savedShape.name}${handMade ? ' (edited)' : ''}`
    : handMade
      ? `Custom, from ${lineup.tactics.formation}`
      : lineup.tactics.formation;

  // The store clones the game, finds the player's own fixture and passes that
  // lineup into the updater, so edits are always applied to the right side.
  const withLineup = (updater: (current: MatchLineup) => MatchLineup) => gameActions().updateFixtureLineup(updater);
  /** The list has answered, or been dismissed: either way it is done with. */
  const closeList = () => {
    setTarget(null);
    setListOpen(false);
  };

  /**
   * A man has just been dragged by his name, and his name is a link.
   *
   * The press that started the drag is the same press a plain click would have
   * used, so the click that follows a drag has to be stopped before the link
   * underneath it acts on it: the manager moved the name, he did not follow it
   * to the man's page.
   */
  const suppressClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  /**
   * A moved dot is the club's shape too, not only this fixture's: a manager who
   * has just sorted his back line out has expressed a preference about how the
   * side plays, and it should still be there next week.
   */
  const carryShape = (next: FormationSlot[], shapeId?: string) => {
    gameActions().updateClubTactics({ ...clubTactics, shape: next, shapeId });
  };

  const moveDot = (index: number, x: number, y: number) => {
    const player = players(lineup.starting[index]?.playerId ?? '');
    const next = moveSlot(lineup, index, x, y, player);
    if (next === lineup) return;
    withLineup(() => next);
    carryShape(next.tactics.shape ?? shape, next.tactics.shapeId);
    const position = next.starting[index]?.position;
    if (position) setAnnouncement(`${player ? playerName(player) : 'The dot'} is now at ${POSITIONS[position].label.toLowerCase()}.`);
  };

  const pointAt = (clientX: number, clientY: number) => {
    const box = pitchRef.current?.getBoundingClientRect();
    return box ? pitchPointAt(box, clientX, clientY) : null;
  };

  /** The shirt nearest a point, measured in the space the manager is looking at. */
  const nearestSlot = (point: { x: number; y: number }): number => {
    const held = diagramFraction(point);
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    shape.forEach((entry, index) => {
      if (index >= lineup.starting.length) return;
      const drawn = diagramFraction(entry);
      const distance = (drawn.left - held.left) ** 2 + (drawn.top - held.top) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  };

  const beginDrag = (event: PointerEvent<HTMLElement>, next: DragState) => {
    // A drag does not start on a control that has its own job — the button in a
    // row, the name that opens the man's page. The dot on the pitch *is* such a
    // control and is the thing being dragged, so pressing anywhere inside it
    // counts: it was the shirt inside the button that took the press, and
    // refusing on that basis was why nothing could be picked up.
    const control = (event.target as HTMLElement).closest(CONTROLS);
    if (control && control !== event.currentTarget) return;
    // Capture can fail if the pointer is already gone; a drag that falls back to
    // the plain move events is better than an unhandled error.
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ }
    movedRef.current = false;
    // A fresh grab clears whatever the last one left behind for its trailing
    // click, so a drag that produced no click at all cannot eat the next one.
    suppressClickRef.current = false;
    originRef.current = { x: event.clientX, y: event.clientY };
    setDrag(next);
  };

  const onDragMove = (event: PointerEvent<HTMLElement>) => {
    if (!drag) return;
    const origin = originRef.current;
    if (origin && !movedRef.current) {
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < DRAG_THRESHOLD) return;
      movedRef.current = true;
    }
    const point = pointAt(event.clientX, event.clientY);
    setOverBench(Boolean(document.elementFromPoint(event.clientX, event.clientY)?.closest('.team-selection__bench')));
    setDrag({ ...drag, ghost: point, pointer: { x: event.clientX, y: event.clientY } });
  };

  const endDrag = (event: PointerEvent<HTMLElement>) => {
    const state = drag;
    setDrag(null);
    setOverBench(false);
    originRef.current = null;
    if (!state || !movedRef.current) return;
    // The pointer moved, so the click that follows is the drag's, not a pick.
    movedRef.current = false;
    suppressClickRef.current = true;

    if (state.kind === 'slot') {
      const benched = players(lineup.starting[state.index]?.playerId ?? '');
      const over = document.elementFromPoint(event.clientX, event.clientY);
      // A dot dropped on a particular substitute is the swap a manager writes
      // down: the substitute gets the shirt and the man in it takes his place
      // on the bench. It is also the way to take a man off when the bench is
      // full, and the way to bring one on when there is nowhere to put him.
      const cameOn = players(over?.closest<HTMLElement>('.bench-dot')?.dataset.playerId ?? '');
      if (cameOn && cameOn.id !== benched?.id) {
        withLineup((current) => swapWithBench(current, state.index, cameOn.id, cameOn));
        setAnnouncement(
          `${playerName(cameOn)} comes on for ${benched ? playerName(benched) : 'the man in that shirt'}.`,
        );
        return;
      }
      // Dropped on the strip itself rather than on a man: he comes off, if the
      // bench has a place for him.
      if (over?.closest('.team-selection__bench')) {
        if (!benched) return;
        if (lineup.bench.length >= 5) {
          setAnnouncement(`${playerName(benched)} stays on — the bench is full.`);
          return;
        }
        withLineup((current) => assignToBench(current, benched.id, benched));
        setAnnouncement(`${playerName(benched)} is on the bench.`);
        return;
      }
      const point = pointAt(event.clientX, event.clientY) ?? state.ghost;
      if (point) moveDot(state.index, point.x, point.y);
      return;
    }

    const player = players(state.playerId);
    if (!player) return;
    const over = document.elementFromPoint(event.clientX, event.clientY);
    // A man dropped on a particular substitute takes his place, even when every
    // place is taken: dropping him there is asking for that shirt, not for a
    // sixth place on the bench.
    const replaced = players(over?.closest<HTMLElement>('.bench-dot')?.dataset.playerId ?? '');
    if (replaced && state.from === 'squad' && replaced.id !== player.id) {
      const hisSlot = lineup.starting.findIndex((slot) => slot.playerId === player.id);
      if (hisSlot < 0) {
        withLineup((current) => replaceOnBench(current, replaced.id, player.id, player));
        setAnnouncement(`${playerName(player)} takes the bench place of ${playerName(replaced)}.`);
        return;
      }
      // He is already in the XI, so this is the same swap as dropping his dot
      // on the substitute: the substitute comes on in his shirt.
      withLineup((current) => swapWithBench(current, hisSlot, replaced.id, replaced));
      setAnnouncement(`${playerName(replaced)} comes on for ${playerName(player)}.`);
      return;
    }
    if (over?.closest('.team-selection__bench')) {
      // A five-man bench is a rule, not a suggestion: he comes off the pitch
      // only if there is somewhere to put him, and the strip says so rather
      // than quietly doing nothing.
      if (state.from === 'bench') return;
      if (lineup.bench.length >= 5) {
        setAnnouncement('The bench is full — take somebody off it first.');
        return;
      }
      withLineup((current) => assignToBench(current, player.id, player));
      setAnnouncement(`${playerName(player)} is on the bench.`);
      return;
    }
    const point = pointAt(event.clientX, event.clientY) ?? state.ghost;
    if (!point) return;
    const index = nearestSlot(point);
    withLineup((current) => placeInSlot(current, index, player.id, player));
    setAnnouncement(
      `${playerName(player)} is at ${POSITIONS[lineup.starting[index]?.position ?? 'CM'].label.toLowerCase()}.`,
    );
  };

  const cancelDrag = () => {
    setDrag(null);
    setOverBench(false);
    originRef.current = null;
    movedRef.current = false;
  };

  /**
   * The keyboard's version of a drag.
   *
   * A dot is a button, so it takes focus; the arrow keys then move it a zone at
   * a time and the position follows exactly as it does when it is dragged. Up
   * the screen is forward, because that is the way the picture is pointed.
   */
  const nudge = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const step: Record<string, { x: number; y: number }> = {
      ArrowUp: { x: STEP_DEPTH, y: 0 },
      ArrowDown: { x: -STEP_DEPTH, y: 0 },
      ArrowLeft: { x: 0, y: -STEP_ACROSS },
      ArrowRight: { x: 0, y: STEP_ACROSS },
    };
    const delta = step[event.key];
    // The keeper has one line to stand on: only the sideways keys mean anything
    // to him, and up and down would be clamped straight back to where he was.
    if (!delta || (lineup.starting[index]?.position === 'GK' && delta.x !== 0)) return;
    event.preventDefault();
    const current = shape[index] ?? shape[0]!;
    moveDot(index, current.x + delta.x, current.y + delta.y);
  };

  const pickerSlotPosition: PositionCode | null =
    target?.kind === 'starting' ? lineup.starting[target.index]?.position ?? null : null;

  /**
   * The squad, with where each man already is.
   *
   * Everybody is in this list, always. Leaving out the men who are already in
   * the XI was the worst thing about the old picker: it made the obvious move —
   * the right back who should be at left back — impossible from the list, and it
   * hid the fact that the man you wanted was in the side all along. A man who is
   * already picked is shown as picked, and choosing him swaps the two shirts.
   */
  const roster = squad
    .map((player) => ({
      player,
      slotIndex: lineup.starting.findIndex((slot) => slot.playerId === player.id),
      onBench: lineup.bench.some((slot) => slot.playerId === player.id),
      score: pickerSlotPosition
        ? positionScore(player, pickerSlotPosition)
        : positionScore(player, player.preferredPosition),
    }))
    .sort((a, b) => {
      const availabilityWeight = (player: Player) => (player.availability.status === 'doubtful' ? -0.08 : 0);
      return b.score + availabilityWeight(b.player) - (a.score + availabilityWeight(a.player));
    });

  const held = drag?.kind === 'slot' ? drag.index : null;
  const dropIndex = drag?.kind === 'player' && drag.ghost ? nearestSlot(drag.ghost) : null;
  const zoneLabel =
    drag?.kind === 'slot' && drag.ghost
      ? lineup.starting[drag.index]?.position === 'GK'
        ? POSITIONS.GK.label
        : `${POSITIONS[positionForPoint(drag.ghost.x, drag.ghost.y, { outfieldOnly: true })].label}`
      : drag?.kind === 'player' && drag.ghost && dropIndex !== null
        ? `To ${POSITIONS[lineup.starting[dropIndex]!.position].label.toLowerCase()}`
        : null;
  const heldPlayer = drag?.kind === 'player' ? players(drag.playerId) : undefined;

  /** Where each man is, said in three words rather than a sentence. */
  const whereAbout = (slotIndex: number, onBench: boolean) => {
    if (target?.kind === 'starting' && slotIndex === target.index) return { label: 'In the XI here', tone: 'accent' as const };
    if (slotIndex >= 0) return { label: `In the XI at ${lineup.starting[slotIndex]!.position}`, tone: 'muted' as const };
    if (onBench) return { label: 'On the bench', tone: 'muted' as const };
    return { label: 'Not selected', tone: 'muted' as const };
  };

  return (
    <div className="team-selection">
      <PageHeader
        eyebrow="Team"
        title="Team selection"
        tone={errors.length > 0 ? 'danger' : 'default'}
        actions={
          <div className="row row--wrap">
            <select
              className="input input--small"
              value={lineup.tactics.formation}
              aria-label="Formation"
              onChange={(event) => {
                const formation = event.target.value as FormationId;
                // Choosing a named formation is choosing its own eleven: the
                // dots go back to the grid and the custom shape is forgotten.
                carryShape(formationSlotsFor(formation), undefined);
                withLineup((current) => applyFormation(current, formation, squad));
              }}
            >
              {FORMATION_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <label className="fact team-selection__captain">
              <span className="fact__label">Captain</span>
              <select
                className="input input--small"
                value={lineup.captainId ?? ''}
                aria-label="Captain"
                onChange={(event) => withLineup((current) => setCaptain(current, event.target.value || null))}
              >
                <option value="">No captain</option>
                {lineup.starting.map((slot: LineupSlot) => {
                  const player = players(slot.playerId);
                  return (
                    <option key={slot.playerId} value={slot.playerId}>
                      {player ? `${player.firstName.charAt(0)}. ${player.surname}` : 'Unknown'}
                    </option>
                  );
                })}
              </select>
            </label>
            <Button
              variant="ghost"
              onClick={() => {
                const selection = autoPickLineup(squad, lineup.tactics.formation, { shape: lineup.tactics.shape });
                withLineup((current) => ({
                  ...current,
                  starting: selection.starting,
                  bench: selection.bench,
                  captainId: current.captainId && selection.starting.some((slot) => slot.playerId === current.captainId)
                    ? current.captainId
                    : selection.starting[0]?.playerId ?? null,
                }));
              }}
            >
              Ask the assistant to pick
            </Button>
            <Button variant="ghost" size="sm" className="team-selection__list-open" onClick={() => setListOpen(true)}>
              The squad
            </Button>
          </div>
        }
      />

      <div className="team-selection__workspace">
        <section className="team-selection__pitch">
          <div className="team-selection__frame">
            <div
              className="pitch pitch--static pitch--preparation"
              ref={pitchRef}
              data-dragging={drag ? 'true' : undefined}
            >
              <span className="pitch__halfway" />
              <span className="pitch__circle" />
              <span className="pitch__box pitch__box--left" />
              <span className="pitch__box pitch__box--right" />
              <span className="pitch__direction" aria-hidden="true">↑ Attacking</span>
              {lineup.starting.map((slot, index) => {
                const player = players(slot.playerId);
                // The dot is drawn where it is being held when it is being
                // dragged, and where it stands otherwise.
                const formationSlot: FormationSlot =
                  drag?.kind === 'slot' && drag.index === index && drag.ghost
                    ? { ...(shape[index] ?? shape[0]!), ...drag.ghost }
                    : shape[index] ?? shape[0]!;
                const keeper = slot.position === 'GK';
                return (
                  <button
                    key={`${slot.playerId}-${index}`}
                    type="button"
                    className={`pitch__player${target?.kind === 'starting' && target.index === index ? ' pitch__player--active' : ''}${
                      slot.outOfPosition ? ' pitch__player--oops' : ''
                    }${held === index ? ' pitch__player--dragging' : ''}${dropIndex === index ? ' pitch__player--target' : ''}${
                      keeper ? ' pitch__player--keeper' : ''
                    }`}
                    style={diagramStyle(diagramPosition(formationSlot))}
                    aria-pressed={target?.kind === 'starting' && target.index === index}
                    onClick={() => {
                      // A drag that ended on this dot must not also open the
                      // picker: the manager moved a man, he did not ask a
                      // question.
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      // Pressing the shirt again puts the question away, because
                      // the list has no room for a heading and a Close button
                      // both.
                      const asked = target?.kind === 'starting' && target.index === index;
                      setTarget(asked ? null : { kind: 'starting', index });
                      setAnnouncement(
                        asked
                          ? 'The squad list is back to the whole squad.'
                          : `${POSITIONS[slot.position].label} selected: the men who can play there are marked in the squad list.`,
                      );
                    }}
                    onPointerDown={(event) => beginDrag(event, { kind: 'slot', index, ghost: null, pointer: null })}
                    onPointerMove={onDragMove}
                    onPointerUp={endDrag}
                    onPointerCancel={cancelDrag}
                    onKeyDown={(event) => nudge(event, index)}
                    title={
                      player
                        ? `${playerName(player)} — ${POSITIONS[slot.position].label}${
                            slot.outOfPosition ? ' · out of position' : ''
                          }${keeper ? ' · drag him along his line' : ' · drag, or use the arrow keys'}`
                        : 'Empty'
                    }
                  >
                    <span className="pitch__shirt">{slot.position}</span>
                    <span className="pitch__name">
                      {player ? player.surname : 'Empty'}
                      {slot.outOfPosition ? ' ⚠' : ''}
                    </span>
                  </button>
                );
              })}
              {/* The two controls that belong on the pitch rather than in a
                  column beside it: the state of the selection, asked for, and
                  the shape, kept. Both are small, and both sit in a corner the
                  furthest man forward never reaches. */}
              <div className="pitch__tools">
                <button
                  type="button"
                  className={`pitch__tool${errors.length > 0 ? ' pitch__tool--bad' : warnings.length > 0 ? ' pitch__tool--warn' : ''}`}
                  aria-expanded={pitchPanel === 'warnings'}
                  aria-controls={pitchPanel === 'warnings' ? 'pitch-warnings' : undefined}
                  onClick={() => setPitchPanel(pitchPanel === 'warnings' ? null : 'warnings')}
                  title={
                    problems.length === 0
                      ? 'No selection problems'
                      : `${errors.length} problem${errors.length === 1 ? '' : 's'} to fix, ${warnings.length} to watch`
                  }
                >
                  <UIGlyph name="warn" />
                  <span className="pitch__tool-count" aria-hidden="true">
                    {problems.length}
                  </span>
                  <span className="visually-hidden">
                    {problems.length === 0
                      ? 'Selection problems: none'
                      : `Selection problems: ${problems.length}`}
                  </span>
                </button>
                <button
                  type="button"
                  className="pitch__tool"
                  aria-expanded={pitchPanel === 'shape'}
                  aria-controls={pitchPanel === 'shape' ? 'pitch-shape' : undefined}
                  onClick={() => setPitchPanel(pitchPanel === 'shape' ? null : 'shape')}
                  title={
                    handMade
                      ? `Keep this shape: ${shapeLabel}`
                      : `Keep the ${lineup.tactics.formation} shape under a name`
                  }
                >
                  <Glyph name="save" />
                  <span className="visually-hidden">Keep this shape</span>
                </button>
              </div>

              {/* The selection's problems, over the grass it is asking about:
                  the manager looked at the icon, so the answer belongs where he
                  is looking rather than in a panel beside the pitch. */}
              {pitchPanel === 'warnings' && (
                <div className="pitch__panel" id="pitch-warnings" role="dialog" aria-label="Selection problems">
                  <div className="pitch__panel-head">
                    <h4 className="subhead">Selection problems</h4>
                    <button type="button" className="link" onClick={() => setPitchPanel(null)}>
                      Close
                    </button>
                  </div>
                  {problems.length === 0 ? (
                    <p className="small">Nothing to fix: the eleven and the bench are both legal.</p>
                  ) : (
                    <ul className="tight-list">
                      {[...errors, ...warnings].map((problem, index) => (
                        <li key={`${problem.message}-${index}`}>
                          <Pill tone={problem.severity === 'error' ? 'bad' : 'warn'}>
                            {problem.severity === 'error' ? 'Problem' : 'Watch'}
                          </Pill>{' '}
                          {problem.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* The shape, kept from the pitch it was drawn on: a name, a
                  button, and the manager's own shapes, set out again in one
                  click from here. */}
              {pitchPanel === 'shape' && (
                <div className="pitch__panel" id="pitch-shape" role="dialog" aria-label="Keep this shape">
                  <div className="pitch__panel-head">
                    <h4 className="subhead">Keep this shape</h4>
                    <button type="button" className="link" onClick={() => setPitchPanel(null)}>
                      Close
                    </button>
                  </div>
                  <p className="small muted">
                    {handMade
                      ? `${shapeLabel}. The dots are where you put them; ${lineup.tactics.formation} is what they were built from.`
                      : `${lineup.tactics.formation} — ${getFormation(lineup.tactics.formation).description}`}
                  </p>
                  <div className="row row--wrap">
                    <input
                      className="input input--small"
                      aria-label="Name this shape"
                      placeholder="Give it a name"
                      value={shapeName}
                      onChange={(event) => setShapeName(event.target.value)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!shapeName.trim()}
                      onClick={() => {
                        gameActions().saveFormationShape(shapeName, shape);
                        setShapeName('');
                      }}
                    >
                      Save it
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!lineup.tactics.shape}
                      onClick={() => {
                        carryShape(formationSlotsFor(lineup.tactics.formation), undefined);
                        withLineup((current) => clearShape(current, squad));
                      }}
                    >
                      Put the dots back to {lineup.tactics.formation}
                    </Button>
                  </div>

                  <h4 className="subhead">Your shapes</h4>
                  {game.customFormations.length === 0 ? (
                    <p className="small muted">Nothing saved yet. A saved shape is set out again in one click.</p>
                  ) : (
                    <ul className="tight-list shape-book">
                      {game.customFormations.map((saved) => {
                        const applied = lineup.tactics.shapeId === saved.id;
                        return (
                          <li key={saved.id} className={`shape-book__row${applied ? ' shape-book__row--applied' : ''}`}>
                            <span className="shape-book__name">
                              <strong>{saved.name}</strong>{' '}
                              <span className="muted small">
                                {saved.base}
                                {applied && handMade ? ' · edited' : ''}
                              </span>
                            </span>
                            <span className="row">
                              <Button
                                variant={applied ? 'primary' : 'ghost'}
                                size="sm"
                                ariaLabel={`Set the side out in ${saved.name}`}
                                onClick={() => {
                                  gameActions().updateClubTactics({
                                    ...clubTactics,
                                    formation: saved.base,
                                    shape: saved.slots,
                                    shapeId: saved.id,
                                  });
                                  withLineup((current) =>
                                    applyShape(current, saved.slots, squad, { formation: saved.base, shapeId: saved.id }),
                                  );
                                  setAnnouncement(`The side is set out in ${saved.name}.`);
                                }}
                              >
                                {applied ? 'Set out' : 'Use it'}
                              </Button>
                              <button
                                type="button"
                                className="link"
                                onClick={() => gameActions().deleteFormationShape(saved.id)}
                                aria-label={`Forget the shape ${saved.name}`}
                              >
                                forget
                              </button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
              {/* What the man in the air will be, while he is in the air. */}
              {zoneLabel && drag?.ghost && (
                <span className="pitch__zone" style={diagramStyle(drag.ghost)}>
                  {zoneLabel}
                </span>
              )}
              {lineup.starting.length === 0 && (
                <span className="pitch__empty small">No XI is picked for this fixture yet.</span>
              )}
            </div>
          </div>

          {/* The substitutes are a stack of shirts beside the pitch, the way a
              manager writes them on a teamsheet: the other end of a drag, and
              the place a man comes off to. */}
          <div className={`team-selection__bench${overBench ? ' team-selection__bench--over' : ''}`}>
            <h4 className="subhead">Subs ({lineup.bench.length}/5)</h4>
            <ul className="bench-stack">
              {lineup.bench.map((slot: BenchSlot) => {
                const player = players(slot.playerId);
                return (
                  <li
                    key={slot.playerId}
                    className="bench-dot"
                    data-player-id={slot.playerId}
                    onClickCapture={suppressClick}
                    onPointerDown={
                      player
                        ? (event) =>
                            beginDrag(event, { kind: 'player', playerId: slot.playerId, from: 'bench', ghost: null, pointer: null })
                        : undefined
                    }
                    onPointerMove={onDragMove}
                    onPointerUp={endDrag}
                    onPointerCancel={cancelDrag}
                    title={player ? `${playerName(player)} — drag him onto a shirt to bring him on` : undefined}
                  >
                    <span className="bench-dot__shirt">{slot.position}</span>
                    <span className="bench-dot__who">
                      <PlayerLink personId={slot.playerId}>{player ? player.surname : 'Unknown'}</PlayerLink>
                    </span>
                  </li>
                );
              })}
              {lineup.bench.length === 0 && (
                <li className="bench-dot bench-dot--empty">
                  <span className="small muted">Drag a man here from the squad list.</span>
                </li>
              )}
            </ul>
          </div>
        </section>

        {/* The squad list and the shape share a column when there is not room
            for the pitch, the squad and the shape side by side. */}
        <div className={`team-selection__aside${target || listOpen ? ' team-selection__aside--open' : ''}`}>
        {/* The picker lives on the screen rather than appearing on a click: a
            list that is always there is the thing that makes dragging a name
            onto a shirt a movement across the screen instead of a scroll. Its
            heading says who it is for, and only that part changes. */}
        <section
          className="team-selection__squad selection-picker"
          ref={pickerRef}
          tabIndex={-1}
          role="region"
          aria-label="Choose a player"
        >
          {/* No heading and no explanation over the list: the list is the screen,
              and a heading over twenty names was two lines of the squad that the
              manager had to scroll past. What the highlight means is said to the
              screen reader instead, where it costs no room. */}
          <Panel
            actions={(target || listOpen) ? <Button variant="ghost" size="sm" onClick={closeList}>Close</Button> : undefined}
            level="primary"
          >
            <ul className="picker">
              {roster.map(({ player, score, slotIndex, onBench }) => {
                const here = target?.kind === 'starting' && slotIndex === target.index;
                const elsewhere = slotIndex >= 0 && !here;
                const about = whereAbout(slotIndex, onBench);
                return (
                  <li
                    key={player.id}
                    data-player-id={player.id}
                    className={`picker__row${here ? ' picker__row--here' : ''}${elsewhere ? ' picker__row--xi' : ''}${
                      target?.kind === 'starting' && !here && score >= 0.55 ? ' picker__row--fits' : ''
                    }`}
                    title="Drag this name onto a shirt to pick him"
                    onClickCapture={suppressClick}
                    onPointerDown={(event) =>
                      beginDrag(event, { kind: 'player', playerId: player.id, from: 'squad', ghost: null, pointer: null })
                    }
                    onPointerMove={onDragMove}
                    onPointerUp={endDrag}
                    onPointerCancel={cancelDrag}
                  >
                    <span className="picker__grip" aria-hidden="true" />
                    <span className="picker__who">
                      <PlayerLink personId={player.id}>
                        <strong>{playerName(player)}</strong>
                      </PlayerLink>{' '}
                      <Pill tone={about.tone}>{about.label}</Pill>
                      <span className="muted small">
                        {player.preferredPosition} · {player.age} · {player.occupation} · form {Math.round(player.form)}
                        {player.availability.status !== 'available' ? ' · ' : ''}
                      </span>
                      {player.availability.status !== 'available' && (
                        <Pill tone={availabilityTone(player.availability.status)} title={player.availability.note ?? undefined}>
                          {player.availability.status}
                        </Pill>
                      )}
                    </span>
                    <span className="picker__fit" title={`${Math.round(score * 100)}% fit${pickerSlotPosition ? ` at ${pickerSlotPosition}` : ''}`}>
                      <Meter value={score * 100} tone={score > 0.7 ? 'ok' : score > 0.55 ? 'accent' : 'warn'} />
                      <span className="muted small">{Math.round(score * 100)}%</span>
                    </span>
                    <span className="picker__act">
                      {here ? (
                        <Button size="sm" disabled>
                          In the side
                        </Button>
                      ) : target?.kind === 'starting' ? (
                        <Button
                          size="sm"
                          ariaLabel={
                            elsewhere
                              ? `Swap in ${playerName(player)} at ${POSITIONS[pickerSlotPosition ?? 'CM'].label.toLowerCase()}`
                              : `Pick ${playerName(player)} at ${pickerSlotPosition}`
                          }
                          onClick={() => {
                            withLineup((current) => placeInSlot(current, target.index, player.id, player));
                            closeList();
                          }}
                        >
                          {elsewhere ? 'Swap in' : 'Pick'}
                        </Button>
                      ) : target?.kind === 'bench' ? (
                        onBench ? (
                          <Button
                            size="sm"
                            ariaLabel={`Remove ${playerName(player)} from the bench`}
                            onClick={() => {
                              withLineup((current) => removeFromBench(current, player.id));
                              closeList();
                            }}
                          >
                            Remove
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={lineup.bench.length >= 5}
                            title={lineup.bench.length >= 5 ? 'The bench is full — take somebody off it first' : undefined}
                            ariaLabel={`Bench ${playerName(player)}`}
                            onClick={() => {
                              withLineup((current) => assignToBench(current, player.id, player));
                              closeList();
                            }}
                          >
                            Bench
                          </Button>
                        )
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setTarget({ kind: 'bench' })}>
                          Bench
                        </Button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>

            {target?.kind === 'starting' && lineup.bench.length > 0 && (
              <>
                <h4 className="subhead">Or swap with a substitute</h4>
                <ul className="tight-list">
                  {lineup.bench.map((bench: BenchSlot) => {
                    const player = players(bench.playerId);
                    if (!player) return null;
                    return (
                      <li key={bench.playerId} className="shape-book__row">
                        <span>
                          <PlayerLink personId={bench.playerId}>{playerName(player)}</PlayerLink>
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            withLineup((current) => swapWithBench(current, target.index, player.id, player));
                            closeList();
                          }}
                        >
                          Swap in
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {target?.kind === 'starting' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  withLineup((current) => clearSlot(current, target.index));
                  closeList();
                }}
              >
                Leave it empty
              </Button>
            )}


            <p className="small muted lineup__hint">
              Drag a dot anywhere on the pitch and the job becomes the one that zone is for, or drag a man out of
              this list onto a shirt. The arrow keys move a focused dot.
            </p>
          </Panel>
        </section>
        </div>
      </div>

      {/* Somebody in the manager's hand, following the pointer. */}
      {drag?.kind === 'player' && drag.pointer && heldPlayer && (
        <span className="drag-chip" style={{ left: drag.pointer.x, top: drag.pointer.y }}>
          {playerName(heldPlayer)}
          <span className="muted small">{zoneLabel ?? 'drop him on a shirt'}</span>
        </span>
      )}

      {/* The keyboard's drag still has to say what it did. */}
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
    </div>
  );
}

/** The named formation's own eleven, for a formation the manager has just chosen. */
function formationSlotsFor(formation: FormationId): FormationSlot[] {
  return getFormation(formation).slots.map((slot) => ({ ...slot }));
}
