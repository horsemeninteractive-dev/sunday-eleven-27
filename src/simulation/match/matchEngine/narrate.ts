import type { CommentaryCategory, CommentaryEvent, CommentaryPriority, Match, MatchEvent } from '@/domain/match';
import type { MatchEnvironment } from '../core';
import { sideOfClub } from '../core';
import { makeCommentaryLine } from '../passages';

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

/**
 * The line the engine's own sentence is dressed up into.
 *
 * The engine's text is used when there is nothing better to say — a corner is a
 * corner — and a richer sentence is written where the names matter: a goal wants
 * the scorer, a save wants the keeper.
 */
function proseFor(event: MatchEvent, env: MatchEnvironment): string {
  const scorer = personName(env, event.playerId);
  // The second man on the event means whatever the event is about: the keeper
  // who saved, the teammate a pass found, or the opponent a carry beat.
  const second = personName(env, event.secondaryPlayerId);
  const club = event.clubId ? env.clubShortName(event.clubId) : null;

  switch (event.type) {
    case 'goal':
      return scorer ? `${scorer} scores${club ? ` for ${club}` : ''}!` : event.text;
    case 'own-goal':
      return scorer ? `${scorer} turns it into his own net${club ? ` — ${club}` : ''}.` : event.text;
    case 'shot-saved':
      return second ? `${second} saves${scorer ? ` from ${scorer}` : ''}.` : event.text;
    case 'pass':
      return scorer ? `${scorer}${second ? ` finds ${second}` : ' plays it forward'}.` : event.text;
    case 'carry':
      return scorer ? `${scorer}${second ? ` drives past ${second}` : ' drives forward'}.` : event.text;
    case 'yellow-card':
      return scorer ? `${scorer} is booked.` : event.text;
    case 'red-card':
      return scorer ? `${scorer} is sent off.` : event.text;
    case 'foul':
      return scorer ? `Foul by ${scorer}.` : event.text;
    case 'tackle':
      return scorer ? `${scorer} wins it back.` : event.text;
    case 'corner':
      return club ? `Corner to ${club}.` : event.text;
    case 'throw-in':
      return club ? `Throw-in to ${club}.` : event.text;
    case 'goal-kick':
      return club ? `Goal kick to ${club}.` : event.text;
    case 'half-time':
    case 'full-time':
    case 'kick-off':
    case 'substitution':
      return event.text;
    default:
      return event.text;
  }
}/**
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
