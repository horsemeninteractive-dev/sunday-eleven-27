import type { CommentaryCategory, CommentaryEvent, CommentaryPriority, Match, MatchEvent } from '@/domain/match';
import { variant } from '@/simulation/prose';
import type { MatchEnvironment } from '../core';
import { sideOfClub } from '../core';

/**
 * Write one line of the transcript.
 *
 * The id here is a placeholder: `recordCommentary` numbers the line as it is
 * filed, so a batch added together is numbered in the order it will be read. The
 * half is read from the match's own half at the moment of writing, which is why
 * the lines are built as the events are drained rather than all at once at the
 * end of the afternoon.
 */
function makeCommentaryLine(
  match: Match,
  line: {
    minute: number;
    side: 'home' | 'away' | null;
    category: CommentaryCategory;
    priority: CommentaryPriority;
    kind?: string | null;
    text: string;
    x?: number;
    y?: number;
    scoreAfter?: { home: number; away: number } | null;
    playerId?: string | null;
  },
): CommentaryEvent {
  return {
    id: `${match.id}_c0`,
    minute: line.minute,
    firstHalf: match.half === 1,
    side: line.side,
    category: line.category,
    priority: line.priority,
    kind: line.kind ?? null,
    text: line.text,
    x: line.x ?? 0.5,
    y: line.y ?? 0.5,
    scoreAfter: line.scoreAfter ?? null,
    playerId: line.playerId ?? null,
  };
}

/**
 * The match's own voice, for the new engine's record.
 *
 * The engine writes terse, honest events — a goal, a save, a corner — because
 * they are the record, not the telling. This is the telling: a reader that turns
 * each event into a line of commentary with the names a manager would hear. It
 * decides nothing and invents nothing; every line describes an event the engine
 * already produced, in the order it produced it.
 *
 * It exists because commentary used to be written by the old minute engine,
 * chain by chain, and the new engine has no chains. Rather than teach the engine
 * to write prose — which would put a presenter inside the football — the prose is
 * written here, from the record, where it can never change a result.
 */

function categoryFor(event: MatchEvent): CommentaryCategory {
  switch (event.type) {
    case 'goal':
    case 'own-goal':
    case 'penalty-scored':
    case 'penalty-missed':
      return 'major';
    case 'shot-saved':
    case 'shot-blocked':
    case 'shot-off-target':
    case 'chance':
      return 'chance';
    case 'foul':
    case 'tackle':
    case 'yellow-card':
    case 'red-card':
    case 'offside':
      return 'challenge';
    case 'pass':
      return 'passing';
    case 'carry':
      return 'movement';
    case 'corner':
    case 'throw-in':
    case 'goal-kick':
      return 'dead-ball';
    case 'half-time':
    case 'full-time':
    case 'extra-time':
    case 'penalties':
      return 'period';
    default:
      return 'possession';
  }
}

function priorityFor(event: MatchEvent): CommentaryPriority {
  if (event.importance >= 3) return 'major';
  if (event.importance === 2) return 'important';
  switch (event.type) {
    case 'corner':
    case 'foul':
    case 'offside':
    case 'throw-in':
      return 'contextual';
    default:
      return 'routine';
  }
}

function kindFor(event: MatchEvent): string | null {
  switch (event.type) {
    case 'goal':
      return 'Goal';
    case 'own-goal':
      return 'Own goal';
    case 'penalty-scored':
      return 'Penalty scored';
    case 'penalty-missed':
      return 'Penalty missed';
    case 'yellow-card':
      return 'Yellow card';
    case 'red-card':
      return 'Red card';
    case 'substitution':
      return 'Substitution';
    case 'injury':
      return 'Injury';
    case 'corner':
      return 'Corner';
    case 'throw-in':
      return 'Throw-in';
    case 'goal-kick':
      return 'Goal kick';
    case 'foul':
      return 'Foul';
    case 'offside':
      return 'Offside';
    case 'shot-saved':
      return 'Save';
    case 'tackle':
      return 'Tackle';
    case 'kick-off':
      return 'Kick-off';
    case 'half-time':
      return 'Half time';
    case 'full-time':
      return 'Full time';
    case 'extra-time':
      return 'Extra time';
    case 'penalties':
      return 'Penalties';
    default:
      return null;
  }
}

function personName(env: MatchEnvironment, id: string | null): string | null {
  if (!id) return null;
  const player = env.getPlayer(id);
  return player ? `${player.firstName.charAt(0)}. ${player.surname}` : null;
}

/* -------------------------------------------------------------------------
 * What each kind of moment sounds like
 *
 * One sentence per event type reads as one person reading one prepared
 * paragraph: every goal scored the same way, every save saved the same way. So
 * every type has a pool here, and `variant` picks from it by the event's own id
 * — the same line every time that event is read, and a different one from the
 * event before it.
 *
 * A phrasing is a template, never a claim of its own. `{scorer}` is the man the
 * event names, `{second}` is the other man on it (the keeper who saved, the
 * teammate a pass found, the opponent a carry beat), `{club}` is the side it
 * belongs to, and `{home}`/`{away}` are the score the event was written with. A
 * template that needs something the event does not carry is passed over for the
 * next one in the pool, and a pool with nothing to say falls back to the
 * engine's own sentence — which is why nothing here can invent a fact.
 */

const GOAL_LINES = [
  '{scorer} scores for {club}!',
  '{scorer} scores!',
  '{scorer} buries it for {club}.',
  '{scorer} puts it away — a goal for {club}.',
  'Goal for {club}: {scorer} makes no mistake.',
  '{scorer} finds the net for {club}.',
  '{scorer} scores, and the ball in was from {second}.',
  '{scorer} gets the goal for {club}; {second} made it.',
];

const OWN_GOAL_LINES = [
  '{scorer} turns it into his own net — {club} will take that.',
  '{scorer} puts it past his own keeper, and {club} lead the cheers.',
  'Own goal: {scorer}, and {club} are the ones who benefit.',
  '{scorer} slices it into his own net.',
];

const PENALTY_SCORED_LINES = [
  '{scorer} scores from the spot.',
  '{scorer} buries the penalty for {club}.',
  'No mistake from twelve yards — {scorer}.',
  '{scorer} sends the keeper the wrong way.',
  'Penalty to {club}, and {scorer} puts it away.',
];

/* A penalty that did not go in, which the engine writes whether the keeper got
   to it or the taker put it somewhere he should not have. Nothing here claims
   which, because the record does not say. */
const PENALTY_MISSED_LINES = [
  '{scorer} misses from the spot.',
  '{scorer} cannot convert the penalty.',
  'Penalty missed by {scorer}.',
  '{club} waste the penalty — {scorer} cannot put it away.',
  '{scorer} will not want to see that again.',
];

const SAVE_LINES = [
  '{second} saves from {scorer}.',
  'Good save by {second}.',
  '{second} gets down to it.',
  '{scorer} is denied by {second}.',
  '{second} pushes it away.',
  'Saved by {second}!',
];

/* `playerId` on a block is the man whose shot it was and `secondaryPlayerId` is
   the body in the way, so the two are named the way a pass names its target. */
const BLOCKED_LINES = [
  '{scorer} has it blocked.',
  'Blocked — {scorer} cannot get it through.',
  'A block denies {scorer}.',
  '{second} gets in the way of {scorer}.',
  'Blocked by {second}.',
];

/* Off target covers two things the engine does not separate: a shot wide or
   over, and one off the woodwork. So the line says what is true of both — he
   did not hit the target — and never claims which. */
const OFF_TARGET_LINES = [
  '{scorer} cannot find the target.',
  '{scorer} is off target.',
  'Off target from {scorer}.',
  '{scorer} will be disappointed with that one.',
  'It will not count — {scorer} off target.',
];

const OFFSIDE_LINES = [
  'Flag up — {scorer} strayed offside.',
  '{scorer} is caught offside.',
  'Offside against {scorer}.',
  '{club} are caught offside.',
  'Offside. {scorer} went too early.',
];

const CORNER_LINES = [
  'Corner to {club}.',
  '{club} win a corner.',
  'It is a corner for {club}.',
  'Behind for a corner — {club} will send the big lads up.',
  'Corner ball for {club}.',
];

const THROW_IN_LINES = [
  'Throw-in to {club}.',
  '{club} have the throw.',
  'Out for a throw to {club}.',
  '{scorer} takes the throw for {club}.',
  'Throw-in, {club}.',
];

const GOAL_KICK_LINES = [
  'Goal kick to {club}.',
  '{club} restart from their own area.',
  'Goal kick, {club}.',
  '{club} get it back the long way.',
];

/* Two of these carry a word the test in `narrate.test.ts` looks for: a pass
   "finds" a man and a carry "drives". */
const PASS_LINES = [
  '{scorer} finds {second}.',
  '{scorer} finds {second} in space.',
  '{scorer} plays it to {second}.',
  '{scorer} slides it to {second}.',
  '{scorer} to {second}.',
  '{scorer} plays it forward.',
  '{scorer} keeps it moving.',
];

const CARRY_LINES = [
  '{scorer} drives at {second}.',
  '{scorer} drives past {second}.',
  '{scorer} drives forward.',
  '{scorer} carries it on.',
  '{scorer} strides forward with it.',
  '{scorer} goes past {second}.',
];

const TACKLE_LINES = [
  '{scorer} wins it back.',
  'Good tackle by {scorer}.',
  '{scorer} takes it off {second}.',
  '{scorer} gets a foot in.',
  'Won by {scorer}.',
  '{scorer} comes away with it.',
];

const FOUL_LINES = [
  'Foul by {scorer}.',
  '{scorer} gives away the free kick.',
  'Foul — {scorer} caught {second}.',
  'The referee has seen it: foul by {scorer}.',
  'Free kick, and it is against {scorer}.',
];

const BOOKING_LINES = [
  '{scorer} is booked.',
  'Yellow card for {scorer}.',
  '{scorer} goes into the book.',
  'That is a booking for {scorer}.',
  '{club} have a man booked — {scorer}.',
];

/* Sent off covers the straight red and the second yellow, so the line says the
   one thing both are: he is off. */
const SENDING_OFF_LINES = [
  '{scorer} is sent off.',
  'Red card — {scorer} is off.',
  '{scorer} is dismissed.',
  '{club} are down to ten: {scorer} has gone.',
  '{scorer} takes the long walk.',
];

/**
 * The injury the engine's own sentence names.
 *
 * `injury` events read "J. Hollis pulls up — tight hamstring.", and the detail
 * after the dash is the one thing the event carries that nothing else here can
 * reconstruct, so it is pulled out and put back into the phrasing rather than
 * thrown away with the rest of the engine's sentence.
 */
function injuryDetail(text: string): string | null {
  const at = text.indexOf(' — ');
  return at < 0 ? null : text.slice(at + 3).replace(/\.$/, '');
}

const INJURY_LINES = [
  '{scorer} pulls up — {detail}.',
  '{scorer} cannot carry on.',
  'Treatment for {scorer}.',
  '{scorer} is down, and it does not look good.',
  '{scorer} signals to the bench — that is his afternoon done.',
  '{scorer} is struggling — plenty of concern here.',
  'A blow for {club}: {scorer} will not be able to continue.',
];

/* The incoming man is the event's player and the outgoing man its second, which
   is the way the engine writes the change. */
const SUBSTITUTION_LINES = [
  '{scorer} replaces {second}.',
  'Change for {club}: {scorer} on for {second}.',
  '{club} make a change — {scorer} for {second}.',
  '{scorer} comes on, {second} goes off.',
  'Fresh legs for {club}: {scorer} for {second}.',
];

/* A chance belongs to a side: the record names the side and does not promise
   which of the eleven it fell to, so these name the club and nothing else. */
const CHANCE_LINES = [
  'Chance for {club}!',
  '{club} fashion an opening.',
  'Opening for {club}.',
  '{club} get a sight of goal.',
  'Half a chance for {club}.',
];

const KICK_OFF_LINES = [
  '{club} get us under way.',
  'Under way — {club} start it.',
  '{club} kick off.',
  'Away we go.',
  'The whistle goes, and {club} get the game started.',
];

const HALF_TIME_LINES = [
  'Half time: {home}-{away}.',
  'That is the interval — {home}-{away}.',
  'Half time. {home}-{away} at the break.',
  'The whistle brings the first half to a close: {home}-{away}.',
  'Half time, and it is {home}-{away}.',
  'That is forty-five done — {home}-{away}.',
];

const FULL_TIME_LINES = [
  'Full time: {home}-{away}.',
  'That is it — {home}-{away}.',
  'Full time at the ground: {home}-{away}.',
  'The referee blows up: {home}-{away}.',
  'All over — {home}-{away}.',
  'That is the finish: {home}-{away}.',
];

const EXTRA_TIME_LINES = [
  'Level after ninety — extra time.',
  'Extra time: {home}-{away}.',
  'We go again: extra time, {home}-{away}.',
  'Ninety minutes could not settle it. Extra time.',
];

const INTERCEPTION_LINES = [
  '{scorer} reads it and intercepts.',
  'Intercepted by {scorer}.',
  '{scorer} steps in front and takes it.',
  'Cut out by {scorer}.',
];

const PENALTY_AWARDED_LINES = [
  'The referee points to the spot.',
  'Penalty!',
  'It is a penalty.',
  'The referee has given a penalty.',
];

/**
 * Fill a phrasing in.
 *
 * Returns null when the template asks for something this event does not carry,
 * so the caller can try the next reading of the same fact rather than print a
 * sentence with a hole in it.
 */
function fill(template: string, values: Record<string, string | null>): string | null {
  let out = template;
  for (const [name, value] of Object.entries(values)) {
    if (!out.includes(`{${name}}`)) continue;
    if (value === null) return null;
    out = out.split(`{${name}}`).join(value);
  }
  return out;
}

/**
 * Say one fact the way this event says it.
 *
 * The pool is read from the event's own id, and a reading that needs a name this
 * event does not have is passed over for the next one — so an ordinary pass and
 * a pass with nobody to name both get a sentence, and neither is the same
 * sentence every week.
 */
function say(
  pool: readonly string[],
  event: MatchEvent,
  values: Record<string, string | null>,
): string | null {
  const chosen = variant(pool, event.id);
  for (const template of [chosen, ...pool.filter((line) => line !== chosen)]) {
    const filled = fill(template, values);
    if (filled !== null) return filled;
  }
  return null;
}

/**
 * The line the engine's own sentence is dressed up into.
 *
 * The engine's text is the last resort, not the first — it is used only where
 * there is nothing to name and no reading of the pool fits, because a corner is
 * not always a corner to the man watching it.
 */
function proseFor(event: MatchEvent, env: MatchEnvironment): string {
  const scorer = personName(env, event.playerId);
  // The second man on the event means whatever the event is about: the keeper
  // who saved, the teammate a pass found, or the opponent a carry beat.
  const second = personName(env, event.secondaryPlayerId);
  const club = event.clubId ? env.clubShortName(event.clubId) : null;
  const score = event.scoreAfter ?? null;
  const values = {
    scorer,
    second,
    club,
    home: score ? String(score.home) : null,
    away: score ? String(score.away) : null,
    detail: injuryDetail(event.text),
  };
  /** The pool's reading, or the engine's own sentence when the pool cannot say it. */
  const line = (pool: readonly string[]) => say(pool, event, values) ?? event.text;

  switch (event.type) {
    case 'goal':
      return line(GOAL_LINES);
    case 'own-goal':
      return line(OWN_GOAL_LINES);
    case 'penalty-scored':
      return line(PENALTY_SCORED_LINES);
    case 'penalty-missed':
      return line(PENALTY_MISSED_LINES);
    case 'shot-saved':
      return line(SAVE_LINES);
    case 'shot-blocked':
      return line(BLOCKED_LINES);
    case 'shot-off-target':
      return line(OFF_TARGET_LINES);
    case 'offside':
      return line(OFFSIDE_LINES);
    case 'corner':
      return line(CORNER_LINES);
    case 'throw-in':
      return line(THROW_IN_LINES);
    case 'goal-kick':
      return line(GOAL_KICK_LINES);
    case 'pass':
      return line(PASS_LINES);
    case 'carry':
      return line(CARRY_LINES);
    case 'tackle':
      return line(TACKLE_LINES);
    case 'foul':
      return line(FOUL_LINES);
    case 'yellow-card':
      return line(BOOKING_LINES);
    case 'red-card':
      return line(SENDING_OFF_LINES);
    case 'injury':
      return line(INJURY_LINES);
    case 'substitution':
      return line(SUBSTITUTION_LINES);
    case 'chance':
      return line(CHANCE_LINES);
    case 'kick-off':
      return line(KICK_OFF_LINES);
    case 'half-time':
      return line(HALF_TIME_LINES);
    case 'full-time':
      return line(FULL_TIME_LINES);
    case 'extra-time':
      return line(EXTRA_TIME_LINES);
    /* `note` is two different things — an interception and a penalty awarded —
       and the only word that tells them apart is the engine's own, so the pool
       is chosen by it rather than by the type alone. */
    case 'note':
      if (event.text === 'Intercepted.') return line(INTERCEPTION_LINES);
      if (event.text === 'Penalty awarded.') return line(PENALTY_AWARDED_LINES);
      return event.text;
    /* A shootout's own sentence is the only place the kick-by-kick score exists:
       it is not on the event, so there is nothing here to say it again with. */
    case 'penalties':
      return event.text;
    default:
      return event.text;
  }
}

/**
 * Turn a batch of engine events into commentary lines.
 *
 * Every event the engine writes is told — the goals and the cards, and the
 * ordinary weave of the match as well: each pass naming the man it found, each
 * carry the man it beat, each tackle. The football is a move rather than a list
 * of incidents, and the transcript is that move read back. It is deliberately
 * not filtered down to the loud moments: a manager watching the words alone
 * should hear the passage build, not only the shot at the end of it.
 *
 * Ids are handed out by `recordCommentary` when they are written down, so the
 * placeholder here is only ever overwritten. `firstHalf` is read from the
 * match's own half at the moment of writing, which is why this is called as the
 * events are drained rather than all at once at the end.
 */
export function commentaryFor(
  events: readonly MatchEvent[],
  match: Match,
  env: MatchEnvironment,
): CommentaryEvent[] {
  return events
    .map((event) =>
      makeCommentaryLine(match, {
      minute: event.minute,
      side: sideOfClub(match, event.clubId),
      category: categoryFor(event),
      priority: priorityFor(event),
      kind: kindFor(event),
      text: proseFor(event, env),
      x: event.x,
      y: event.y,
      scoreAfter: event.type === 'goal' || event.type === 'own-goal' || event.type === 'penalty-scored' ? event.scoreAfter : null,
      playerId: event.playerId,
    }),
  );
}

/**
 * Append to the match's own transcript, creating it the first time.
 *
 * Ids are handed out here rather than at the point of writing, so a batch of
 * lines added together is numbered in the order it will be read, and a line can
 * never collide with one already on the record. This is the only writer of
 * `match.commentary`: the engine decides the football, `commentaryFor` finds the
 * words, and this files them.
 */
export function recordCommentary(match: Match, lines: CommentaryEvent[]): void {
  if (lines.length === 0) return;
  const base = match.commentary?.length ?? 0;
  const next = lines.map((line, index) => ({ ...line, id: `${match.id}_c${base + index + 1}` }));
  match.commentary = [...(match.commentary ?? []), ...next];
}
