import type { GameState } from '@/domain/game';
import { periodOf, type Match, type MatchBallState, type MatchPhase, type PlayerState } from '@/domain/match';
import type { Side } from '@/domain/matchState';
import type { PlayerId } from '@/domain/ids';
import { formationSlots, type PositionCode } from '@/domain/positions';
import { sampleRecording } from '@/domain/matchRecording';
import type { MatchRenderState, RenderTeam } from './renderContract';
import { signalOfEvent, type MatchSignal } from './matchSignals';

/**
 * The shared presentation layer.
 *
 * Renderers are leaves, so the work they share — reading the authoritative state
 * into a neutral shape, smoothing between steps, and working out who is involved
 * — lives here, once, above them. Both the present 2D pitch and any future 3D
 * renderer call into this, so neither owns the football and neither can drift
 * from the other.
 *
 * Nothing in this file decides anything. It reads the simulation's own values
 * and, where a match has no continuous state, lays teams out from their
 * formation so the picture is still sensible. It never advances the clock, moves
 * a player or changes possession: those belong to the simulation alone.
 *
 * There are exactly two things it may read, and each is somebody else's
 * authority: the record the cursor reveals (a replay), and the match's own record
 * ({@link phaseFromRecord}, {@link possessionFromRecord}) for a fixture nobody
 * watched. It reads no dead state of its own — the phase used to come from the
 * retired minute engine's `match.field`, which nothing fills in any more. A
 * watched match does not come through here at all: it has an engine, and reads
 * it through `matchEnginePresentation`.
 *
 * The one other reader is the replay (see `matchReplay`). A finished match has
 * no continuous state left to read — only its record — so a replay asks for the
 * same state through a {@link MatchRenderCursor}, which reveals the record up to
 * a moment and hands the picture a point to lean toward. The renderer is handed
 * the same shape either way, which is what lets one pitch draw both.
 */

/**
 * A straight interpolation between the step a thing was at and the step it is at.
 *
 * This is the one piece of maths a renderer is allowed to do. `alpha` comes from
 * the authoritative residual — how far into the next simulation step we are —
 * so smoothing is identical in 2D and in a future 3D view, and depends on the
 * simulation's clock rather than on the frame rate.
 */
export function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

/** Where a sample that carries `px/py` and `x/y` is drawn at this instant. */
export function interpolatedX(sample: { px: number; x: number }, alpha: number): number {
  return lerp(sample.px, sample.x, alpha);
}

export function interpolatedY(sample: { py: number; y: number }, alpha: number): number {
  return lerp(sample.py, sample.y, alpha);
}

/** The angle a player is travelling at, from the velocity the simulation owns. */
export function facingRadians(vx: number, vy: number): number {
  return Math.atan2(vy, vx);
}

/** Whether a velocity is enough to be worth drawing movement for. */
export function isMoving(vx: number, vy: number): boolean {
  return Math.hypot(vx, vy) > 0.004;
}

/**
 * Who is involved in the move, as readings rather than instructions.
 *
 * A renderer uses this to pick a few people out of the crowd — the carrier, the
 * man a pass is going to, the man closing down, a keeper — without naming all
 * twenty-two. It is computed from the same authoritative state in both
 * renderers, so what counts as "involved" cannot mean two different things on
 * two screens.
 */
export interface MatchInvolvement {
  possessing: Side | null;
  carrying: Set<PlayerId>;
  receiving: Set<PlayerId>;
  involved: Set<PlayerId>;
  celebrating: Set<PlayerId>;
  pressing: Set<PlayerId>;
  scorerId: PlayerId | null;
}

export function involvementOf(state: MatchRenderState): MatchInvolvement {
  const owner = state.ball.ownerId;
  const target = state.ball.status === 'travelling' ? state.ball.targetId : null;
  const celebration = state.celebration;
  const possessing = owner
    ? (state.players.find((node) => node.playerId === owner)?.side ?? state.possession)
    : state.possession;

  const carrying = new Set<PlayerId>();
  const receiving = new Set<PlayerId>();
  const involved = new Set<PlayerId>();
  const celebrating = new Set<PlayerId>();
  const pressing = new Set<PlayerId>();

  for (const node of state.players) {
    const isCarrying = owner === node.playerId;
    const isReceiving = target === node.playerId;
    const onScoringSide = celebration !== null && celebration.side === node.side;
    if (isCarrying) carrying.add(node.playerId);
    if (isReceiving) receiving.add(node.playerId);
    if (isCarrying || isReceiving || node.action === 'chasing' || onScoringSide || node.position === 'GK') {
      involved.add(node.playerId);
    }
    if (onScoringSide) celebrating.add(node.playerId);
    if (possessing !== null && possessing !== node.side && node.action === 'chasing') pressing.add(node.playerId);
  }

  return { possessing, carrying, receiving, involved, celebrating, pressing, scorerId: celebration?.scorerId ?? null };
}

/** A blank ball, used only when a match has no continuous state of its own. */
function restingBall(x: number, y: number): MatchBallState {
  return {
    x,
    y,
    px: x,
    py: y,
    status: 'loose',
    ownerId: null,
    targetId: null,
    tx: x,
    ty: y,
    speed: 0,
    height: 0,
    touchedAt: 0,
    lastTouchId: null,
  };
}

/** Where the ball was last heard of, for a match with no spatial state. */
function lastEventPoint(match: Match): { x: number; y: number } {
  const last = match.events[match.events.length - 1];
  return last ? { x: last.x, y: last.y } : { x: 0.5, y: 0.5 };
}

/**
 * The old way of laying a team out: the formation, leaned toward the ball.
 *
 * Used when a match has no continuous state to read — an unwatched fixture, a
 * save from before the pitch existed, or a replay, which has only the record.
 * It is presentation reconstruction, not football: it never feeds anything back
 * into the simulation. `focus` is where the ball is at this instant, so a replay
 * can move the picture from one recorded moment to the next.
 */
function formationPlayers(match: Match, focus: { x: number; y: number }): PlayerState[] {
  const ball = focus;
  const players: PlayerState[] = [];
  for (const side of ['home', 'away'] as const) {
    const lineup = match.lineups[side];
    // The manager's own shape when he has one: the picture before kick-off shows
    // the eleven he set out, not the named formation he started from.
    const formation = formationSlots(lineup.tactics.formation, lineup.tactics.shape);
    lineup.starting.forEach((slot, index) => {
      // A sent-off man is off the pitch, even in a reconstruction.
      if (match.performances[slot.playerId]?.sentOff) return;
      const formationSlot = formation[index] ?? formation[0]!;
      const baseX = side === 'home' ? formationSlot.x : 1 - formationSlot.x;
      const baseY = side === 'home' ? formationSlot.y : 1 - formationSlot.y;
      const x = Math.max(0.02, Math.min(0.98, baseX * 0.8 + ball.x * 0.2));
      const y = Math.max(0.04, Math.min(0.96, baseY * 0.84 + ball.y * 0.16));
      players.push({
        playerId: slot.playerId,
        side,
        position: slot.position,
        baseX,
        baseY,
        x,
        y,
        px: x,
        py: y,
        tx: x,
        ty: y,
        speed: 0,
        action: 'shape',
        vx: 0,
        vy: 0,
        actionKind: null,
        actionStartedAt: null,
        actionEndsAt: null,
        possession: false,
      });
    });
  }
  return players;
}

/**
 * The static facts about everyone who might appear: side, role and slot.
 *
 * A recording stores only movement — where a man stood — so everything that does
 * not move is read from the lineups, once, when the recording is played back.
 * Starting players get their formation slot; a substitute, who has no slot of
 * his own, gets the middle of the pitch, which is only ever a fallback because
 * the renderer draws the recorded position regardless.
 */
function rosterMeta(
  match: Match,
): Map<PlayerId, { side: Side; position: PositionCode; baseX: number; baseY: number }> {
  const meta = new Map<PlayerId, { side: Side; position: PositionCode; baseX: number; baseY: number }>();
  for (const side of ['home', 'away'] as const) {
    const lineup = match.lineups[side];
    // The manager's own shape when he has one: the picture before kick-off shows
    // the eleven he set out, not the named formation he started from.
    const formation = formationSlots(lineup.tactics.formation, lineup.tactics.shape);
    lineup.starting.forEach((slot, index) => {
      const formationSlot = formation[index] ?? formation[0]!;
      const baseX = side === 'home' ? formationSlot.x : 1 - formationSlot.x;
      const baseY = side === 'home' ? formationSlot.y : 1 - formationSlot.y;
      meta.set(slot.playerId, { side, position: slot.position, baseX, baseY });
    });
    for (const slot of lineup.bench) {
      meta.set(slot.playerId, { side, position: slot.position, baseX: 0.5, baseY: 0.5 });
    }
  }
  // A man substituted off is removed from both the starting XI and the bench, so
  // the lineups alone cannot place him — yet he was on the pitch, and the replay
  // must draw him. His performance record names the club he played for and the
  // position he filled, which is everything the picture needs; his formation
  // base is only a fallback, because a recorded position is drawn regardless.
  for (const performance of Object.values(match.performances)) {
    if (meta.has(performance.playerId)) continue;
    const side: Side | null =
      performance.clubId === match.homeClubId
        ? 'home'
        : performance.clubId === match.awayClubId
          ? 'away'
          : null;
    if (!side) continue;
    meta.set(performance.playerId, {
      side,
      position: performance.positionPlayed,
      baseX: 0.5,
      baseY: 0.5,
    });
  }
  return meta;
}

/**
 * The match as it was actually played, at one instant.
 *
 * A replay's request of the recording: hand back where everyone was and where
 * the ball was, so the pitch can draw the real movement instead of a formation
 * leaned toward a moment. The men who were not on the pitch are simply absent —
 * a substitute's first appearance is his first recorded position, and a man who
 * has gone off stops being drawn.
 *
 * Null when there is nothing recorded: an unwatched match, or a save from before
 * recordings existed. The caller then falls back to the reconstruction.
 */
export function recordedFrame(
  match: Match,
  clock: number,
): { players: PlayerState[]; ball: MatchBallState } | null {
  const recording = match.recording;
  if (!recording) return null;
  const sample = sampleRecording(recording, clock);
  if (!sample) return null;

  const meta = rosterMeta(match);
  const players: PlayerState[] = [];
  const slots = Math.min(recording.roster.length, Math.floor(sample.players.length / 2));
  for (let slot = 0; slot < slots; slot += 1) {
    const x = sample.players[slot * 2]!;
    const y = sample.players[slot * 2 + 1]!;
    // `-1` is a slot that was not on the pitch at this instant.
    if (x < 0 || y < 0) continue;
    const id = recording.roster[slot]!;
    const person = meta.get(id);
    if (!person) continue;
    const carrying = slot === sample.owner;
    const receiving = slot === sample.target;
    players.push({
      playerId: id,
      side: person.side,
      position: person.position,
      baseX: person.baseX,
      baseY: person.baseY,
      x,
      y,
      px: x,
      py: y,
      tx: x,
      ty: y,
      speed: 0,
      action: carrying ? 'carrying' : receiving ? 'chasing' : 'shape',
      vx: 0,
      vy: 0,
      actionKind: null,
      actionStartedAt: null,
      actionEndsAt: null,
      possession: carrying,
    });
  }

  const ownerId = sample.owner >= 0 ? (recording.roster[sample.owner] ?? null) : null;
  const targetId = sample.target >= 0 ? (recording.roster[sample.target] ?? null) : null;
  const ball: MatchBallState = {
    x: sample.ballX,
    y: sample.ballY,
    px: sample.ballX,
    py: sample.ballY,
    status: sample.ballStatus,
    ownerId,
    targetId,
    tx: sample.ballX,
    ty: sample.ballY,
    speed: 0,
    height: 0,
    touchedAt: 0,
    lastTouchId: ownerId,
  };
  return { players, ball };
}

/** Which side an event belongs to, from the club that caused it. */
function sideOfEvent(match: Match, clubId: string | null): Side | null {
  if (clubId === null) return null;
  if (clubId === match.homeClubId) return 'home';
  if (clubId === match.awayClubId) return 'away';
  return null;
}

/**
 * The match's events, told in the shared signal vocabulary.
 *
 * One projection of the authoritative record, built here so every consumer —
 * the incident banner now, a replay or a report later — reads the same story in
 * the same words rather than each re-deriving it from the engine's types.
 */
function signalsOf(match: Match): MatchSignal[] {
  return match.events.map((event) => signalOfEvent(event, sideOfEvent(match, event.clubId)));
}

/**
 * The phase of a match read from its record, for a picture that has no live
 * state to read it from.
 *
 * A match with no continuous state — before kick-off, an unwatched fixture, or a
 * save written before the pitch existed — has no phase of play to report, and the
 * old code pretended otherwise: it read `match.field.phase`, which is the dead
 * minute engine's state and is never written on a match the real engine played,
 * so the phase silently fell back to `'kickoff'` every time. It reads the record
 * now, which is the only authority such a match has: a match that is over is at
 * full time, and one that has not been played is waiting for its kick-off. That
 * is all a static picture can honestly know, and it says so rather than
 * consulting a field nothing fills in.
 */
function phaseFromRecord(match: Match): MatchPhase {
  return match.status === 'finished' ? 'full-time' : 'kickoff';
}

/**
 * Who had the ball, read from the record the engine keeps.
 *
 * `possessionTicks` is written by the simulation alone (see
 * `MatchEngine.drain`), so this is a reading of what Touchline decided rather
 * than an inference about it. A match nobody has played yet has no ticks and no
 * possession; a match that was played reports the side with more of the ball.
 */
function possessionFromRecord(match: Match): Side | null {
  const ticks = match.possessionTicks;
  if (!ticks || ticks.home === ticks.away) return null;
  return ticks.home > ticks.away ? 'home' : 'away';
}

function teamOf(game: GameState, match: Match, side: Side): RenderTeam {
  const clubId = side === 'home' ? match.homeClubId : match.awayClubId;
  const club = game.clubs[clubId]!;
  return {
    side,
    clubId,
    name: club.identity.name,
    colours: { ...club.identity.colours },
    formation: match.lineups[side].tactics.formation,
  };
}

/**
 * A moment of the record to show, instead of the live match.
 *
 * The replay's one request of the shared builder: reveal the match's events up
 * to a moment, and lean the picture toward where the ball is at that instant.
 * With a cursor the builder draws the record rather than the live state, but the
 * shape it produces is identical — which is the whole point.
 */
export interface MatchRenderCursor {
  /** The match minute to show, fractional between recorded moments. */
  minute: number;
  /** How many of the match's events have been reached. */
  revealed: number;
  /** The ball's place at this instant; the teams lean toward it. */
  focus: { x: number; y: number };
  /**
   * Players read back from a recording, when the match was watched.
   *
   * When present the replay draws the real movement instead of laying the teams
   * out from their formation: these are the positions the simulation actually
   * held. Absent — an unwatched match, or a save from before recordings — the
   * builder reconstructs the shape from the lineups, exactly as it used to.
   */
  players?: readonly PlayerState[];
  /** The ball read back from a recording, alongside {@link players}. */
  ball?: MatchBallState;
  /**
   * The phase of play at this instant, when the caller knows it.
   *
   * A recording stores movement and nothing else, so a replay has no phase of
   * its own and the picture stands at kick-off. A caller that *does* hold the
   * authoritative phase — replaying a recording alongside the state it was taken
   * from — may name it here; the renderer still decides nothing, it draws what it
   * was told.
   */
  phase?: MatchPhase;
  /** Who had the ball, when the caller knows; otherwise the replay reads it. */
  possession?: Side | null;
}

/**
 * Read the authoritative match into the neutral shape a renderer consumes.
 *
 * Built once per render, from the live match: it holds references to the
 * simulation's own arrays and a closure over its residual, so it is a window
 * onto the football rather than a copy of it. Building it cannot change a
 * result, and switching renderer is simply a matter of building it and handing
 * it to a different component.
 *
 * With a {@link MatchRenderCursor} it draws the record instead — the replay's
 * door into the same contract — and a match with no continuous state at all
 * still gets a sensible picture from its formations.
 */
export function buildMatchRenderState(match: Match, game: GameState, cursor?: MatchRenderCursor): MatchRenderState {
  const teams: Record<Side, RenderTeam> = {
    home: teamOf(game, match, 'home'),
    away: teamOf(game, match, 'away'),
  };

  if (cursor) {
    // The replay path: only the record, revealed up to the moment asked for,
    // leaned toward where the ball is now. It never reads the finished match's own
    // last state, which would spoil the ending.
    const revealedEvents = match.events.slice(0, Math.max(0, cursor.revealed));
    const signals = revealedEvents.map((event) => signalOfEvent(event, sideOfEvent(match, event.clubId)));
    const last = revealedEvents[revealedEvents.length - 1];
    // A recording, if there is one, is the real movement; otherwise the teams are
    // laid out from their formation and leaned toward the recorded moment.
    const recordedPossession = cursor.ball
      ? (cursor.players?.find((node) => node.playerId === cursor.ball!.ownerId)?.side ??
        (last ? sideOfEvent(match, last.clubId) : null))
      : (last ? sideOfEvent(match, last.clubId) : null);
    // A replay cursor is a minute, not an engine state, so the period is read
    // from the same minute the half is: a recorded match never reaches extra
    // time unless the record says it did, and the halves are the only periods a
    // recording can be in.
    const replayHalf = cursor.minute <= 45 ? 1 : cursor.minute <= 90 ? 2 : 3;
    return {
      continuous: cursor.players !== undefined,
      clock: cursor.minute * 60,
      minute: Math.max(0, Math.round(cursor.minute)),
      half: replayHalf,
      period: replayHalf === 1 ? 'first-half' : replayHalf === 2 ? 'second-half' : 'extra-first',
      phase: cursor.phase ?? 'kickoff',
      // The replay's own reading: the man carrying the ball, or the side the last
      // revealed event belonged to. The record's final possession is deliberately
      // *not* consulted here — a replay must not spoil its own ending.
      possession: cursor.possession ?? recordedPossession,
      players: cursor.players ?? formationPlayers(match, cursor.focus),
      ball: cursor.ball ?? restingBall(cursor.focus.x, cursor.focus.y),
      actions: [],
      celebration: null,
      teams,
      incidents: match.incidents,
      signals,
      revision: revealedEvents.length,
      alpha: () => 0,
    };
  }

  const signals = signalsOf(match);

  const point = lastEventPoint(match);
  const phase: MatchPhase = phaseFromRecord(match);
  return {
    continuous: false,
    clock: 0,
    minute: match.minute,
    half: match.half,
    period: periodOf(match),
    phase,
    possession: possessionFromRecord(match),
    players: formationPlayers(match, point),
    ball: restingBall(point.x, point.y),
    actions: [],
    celebration: null,
    teams,
    incidents: match.incidents,
    signals,
    revision: match.events.length,
    alpha: () => 0,
  };
}
