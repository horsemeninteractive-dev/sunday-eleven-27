import type {
  CommentaryCategory,
  CommentaryEvent,
  CommentaryPriority,
  Match,
  MatchEvent,
  Passage,
  PassageStep,
} from '@/domain/match';
import type { Player } from '@/domain/person';
import type { PositionCode } from '@/domain/positions';
import type { PlayerId } from '@/domain/ids';
import type { Rng } from '../rng';
import type { MatchEnvironment, Side } from './core';

/**
 * The minimum a possession chain must expose for the commentary to measure it.
 *
 * This is deliberately structural rather than an import of the old engine's
 * `PossessionChain`: the shared narrator must not depend on the retired minute
 * engine just to read a duration, and every chain that can be told its share of
 * the words already satisfies this shape.
 */
type ChainSlice = { seconds: number };

/**
 * The match's voice.
 *
 * The engine decides what happens; the spatial layer plays it out; this decides
 * how it is said. Crucially it does not invent the football: it is handed the
 * very passage the pitch is about to play — the man carrying it, the man he is
 * playing it to, and the shot the engine already resolved — and turns those
 * steps into sentences. The words and the picture are therefore the same move,
 * which is the whole point: commentary that describes what is actually
 * happening rather than a story told alongside it.
 *
 * Nothing here can change the football. Every outcome line is the engine's own
 * sentence, every name belongs to a player genuinely on the pitch for that side,
 * and the prose draws its randomness from a stream named for this minute, so
 * adding a line can never move a shot or a card.
 */

const SIDES: Side[] = ['home', 'away'];

/** The label a major moment is announced under, keyed by the event that made it. */
const KIND_LABEL: Record<string, string> = {
  goal: 'Goal',
  'own-goal': 'Own goal',
  'penalty-scored': 'Penalty scored',
  'penalty-missed': 'Penalty missed',
  'shot-saved': 'Save',
  'shot-blocked': 'Blocked',
  'shot-off-target': 'Off target',
  chance: 'Chance',
  corner: 'Corner',
  foul: 'Foul',
  offside: 'Offside',
  'yellow-card': 'Yellow card',
  'red-card': 'Red card',
  injury: 'Injury',
  substitution: 'Substitution',
  'half-time': 'Half time',
  'full-time': 'Full time',
  'kick-off': 'Kick-off',
};

interface OnPitchPlayer {
  player: Player;
  position: PositionCode;
}

function onPitch(match: Match, env: MatchEnvironment, side: Side): OnPitchPlayer[] {
  return match.lineups[side].starting
    .map((slot) => ({ player: env.getPlayer(slot.playerId), position: slot.position }))
    .filter((entry): entry is OnPitchPlayer => Boolean(entry.player));
}

function surname(player: Player | null | undefined): string {
  return player?.surname ?? 'somebody';
}

function sideClubId(match: Match, side: Side): string {
  return side === 'home' ? match.homeClubId : match.awayClubId;
}

/** Where a player is standing, for the map strip, falling back to a sensible point. */
function spot(
  match: Match,
  playerId: PlayerId | null | undefined,
  fallbackX: number,
  fallbackY: number,
): { x: number; y: number } {
  const node = playerId ? match.spatial?.players.find((entry) => entry.playerId === playerId) : undefined;
  return node ? { x: node.x, y: node.y } : { x: fallbackX, y: fallbackY };
}

/** Occasional weather in the words, but never in a way that changes the facts. */
function conditionFlavour(match: Match): string[] {
  const { pitch, weather } = match.conditions;
  if (pitch === 'muddy' || pitch === 'waterlogged') return ['heavy', 'sticky'];
  if (pitch === 'frozen') return ['bobbly', 'hard'];
  if (weather === 'heavy-rain') return ['slick', 'wet'];
  if (weather === 'windy') return ['windy'];
  return [];
}

/**
 * The lines the passage itself produces.
 *
 * One line per step the pitch will play: the man on the ball carries it, then
 * plays it. A shot is deliberately skipped, because its line is the engine's
 * own sentence about the outcome and arrives with the event below — so the
 * build-up describes the move and the engine names the finish.
 */
function passageLines(
  match: Match,
  env: MatchEnvironment,
  side: Side,
  passage: Passage,
  rng: Rng,
): Array<{ text: string; category: CommentaryCategory; priority: CommentaryPriority; playerId: PlayerId | null; side: Side; x: number; y: number; progress: number }> {
  const firstHalf = match.half === 1;
  const previousSide =
    match.commentary && match.commentary.length > 0 ? match.commentary[match.commentary.length - 1]!.side : null;
  const flavour = conditionFlavour(match);

  const lines: Array<{ text: string; category: CommentaryCategory; priority: CommentaryPriority; playerId: PlayerId | null; side: Side; x: number; y: number; progress: number }> = [];

  // Where in the move each line belongs, from how long the steps before it take.
  // The pitch plays the same steps at the same relative times, so a line lands
  // on screen as the thing it describes is being played — not at an even rate
  // decided by how many lines there happen to be.
  const total = passage.steps.reduce((sum, entry) => sum + Math.max(0.01, entry.duration), 0);
  const starts: number[] = [];
  let spent = 0;
  for (const entry of passage.steps) {
    starts.push(total > 0 ? spent / total : 0);
    spent += Math.max(0.01, entry.duration);
  }

  // Every step the pitch plays is said. There is no step without a line and no
  // line without a step: the words and the football are the same sequence, in
  // the same order, so a pass that is played is a pass that is described. Steps
  // used to be dropped whenever a player could not be named or a shot had no
  // event of its own, and those were exactly the moments the pitch went quiet.
  passage.steps.forEach((step: PassageStep, index: number) => {
    const actor = env.getPlayer(step.playerId);
    // A passage may now carry the whole minute — several possessions, and so
    // both sides — so a line is about the side its own step belongs to, not the
    // side the passage as a whole was planned for. The previous step's side is
    // what tells a line it is an interception and not a pass.
    const stepSide = step.side ?? side;
    const previous = index > 0 ? (passage.steps[index - 1]!.side ?? side) : previousSide;
    const turnover = previous !== null && previous !== stepSide;
    const club = env.clubShortName(sideClubId(match, stepSide));
    // Early steps sit further back and later ones nearer the box, so the little
    // map strip traces the move the words are describing.
    const depth = 0.35 + index * 0.25;
    const at = spot(match, step.playerId, 0.5 + (stepSide === 'home' ? -1 : 1) * (0.45 - depth * 0.45), 0.5);
    const progress = starts[index] ?? 0;
    const who = actor ? surname(actor) : club;

    if (step.kind === 'shot') {
      // The finish itself is told by the engine's own event line, with its
      // outcome; this is the strike being taken, so it claims nothing.
      lines.push({
        text: rng.pick([
          `${who} lets fly.`,
          `${who} goes for goal.`,
          `${who} takes it on.`,
          `${who} hits it.`,
        ]),
        category: 'chance',
        priority: 'important',
        playerId: actor?.id ?? null,
        side: stepSide,
        x: at.x,
        y: at.y,
        progress,
      });
      return;
    }

    if (step.kind === 'carry') {
      const text =
        index === 0 && turnover && actor
          ? rng.pick([
              `${who} wins it back for ${club}.`,
              `${who} steps in and comes away with the ball.`,
              `Turnover — ${who} reads it and wins possession.`,
            ])
          : flavour.length > 0 && actor && rng.chance(0.25)
            ? rng.pick([
                `${who} carries it on the ${flavour[0]} surface.`,
                `Good control from ${who} in the ${flavour[0]} conditions.`,
              ])
            : actor
              ? rng.pick([
                  `${who} carries the ball forward.`,
                  `${who} drives into space.`,
                  `${who} advances down the flank.`,
                  `${who} makes ground into the final third.`,
                  `${who} carries it on the ball.`,
                ])
              : rng.pick([`${club} carry it forward.`, `${club} work it on.`, `${club} keep it.`]);
      lines.push({
        text,
        category: turnover ? 'possession' : 'movement',
        priority: 'developing',
        playerId: actor?.id ?? null,
        side: stepSide,
        x: at.x,
        y: at.y,
        progress,
      });
      return;
    }

    // A pass whose man cannot be named is still a pass that was played.
    const receiver = step.targetId ? env.getPlayer(step.targetId) : null;
    const to = receiver ? surname(receiver) : null;
    lines.push({
      text: to
        ? rng.pick([
            `${who} finds ${to} in space.`,
            `${who} plays it out to ${to}.`,
            `${who} slides it through to ${to}.`,
            `${who} feeds ${to}.`,
            `${who} moves it on to ${to}.`,
            `${who} picks out ${to}.`,
          ])
        : rng.pick([
            `${who} plays it out.`,
            `${who} sends it wide.`,
            `${who} puts it into space.`,
            `${who} chips it forward.`,
          ]),
      category: 'passing',
      priority: 'contextual',
      playerId: receiver?.id ?? actor?.id ?? null,
      side: stepSide,
      x: at.x,
      y: at.y,
      progress,
    });
  });

  void firstHalf;
  return lines;
}

/**
 * What a goal looks like once the ball is in the net.
 *
 * A goal is not one line: the pitch plays out the celebration — the scorer gets
 * away and his own team chase him down — so the words have to keep up, or the
 * screen goes quiet at the exact moment it should be loudest. These lines are
 * that celebration said out loud.
 *
 * They claim no outcome of their own: the finish itself was the engine's own
 * sentence and has been written above them. So they carry no `kind`, they name
 * only the scorer and his own club, and their randomness comes from the minute's
 * commentary stream like everything else here — which is why a word about a
 * corner flag can never move a shot.
 */
function celebrationLines(
  match: Match,
  env: MatchEnvironment,
  event: MatchEvent,
  rng: Rng,
): Array<Omit<CommentaryEvent, 'id'>> {
  const scorer = event.playerId ? env.getPlayer(event.playerId) : null;
  const side: Side | null =
    event.clubId === match.homeClubId ? 'home' : event.clubId === match.awayClubId ? 'away' : null;
  if (!scorer || !side) return [];

  const firstHalf = match.half === 1;
  const club = env.clubShortName(sideClubId(match, side));
  const at = spot(match, scorer.id, side === 'home' ? 0.92 : 0.08, 0.14);

  const lines: Array<Omit<CommentaryEvent, 'id'>> = [
    {
      minute: match.minute,
      firstHalf,
      side,
      category: 'major',
      priority: 'important',
      kind: null,
      text: rng.pick([
        `${surname(scorer)} is buried under his own teammates.`,
        `${surname(scorer)} is mobbed before he can even turn round.`,
        `${surname(scorer)} disappears into the huddle with his arms up.`,
        `${surname(scorer)} is chased into the corner and caught by the rest of them.`,
      ]),
      x: at.x,
      y: at.y,
      scoreAfter: null,
      playerId: scorer.id,
    },
  ];

  // The other half of a goal is always the same: somebody has to fetch the ball
  // out of the net, and the match has to start again.
  if (rng.chance(0.7)) {
    lines.push({
      minute: match.minute,
      firstHalf,
      side,
      category: 'major',
      priority: 'contextual',
      kind: null,
      text: rng.pick([
        `Nobody in ${club} is in any hurry to restart.`,
        `The referee looks at his watch while ${club} finish celebrating.`,
        `${surname(scorer)} is still being congratulated as the ball goes back to the centre.`,
      ]),
      x: 0.5,
      y: 0.5,
      scoreAfter: null,
      playerId: scorer.id,
    });
  }

  return lines;
}

/**
 * One minute of commentary.
 *
 * The passage the pitch is playing is told first, step by step, then the rest of
 * the minute — a foul, a booking, a knock, a change — is told in its own place.
 * If the engine named a shot, its own sentence about the outcome closes the
 * move, and a goal is followed by the celebration itself. Minutes that produced
 * no move still get the ordinary traffic of the game, because a match that is
 * silent between incidents is not a match.
 */
export function buildMinuteCommentary(
  match: Match,
  env: MatchEnvironment,
  possessionSide: Side,
  events: MatchEvent[],
  passage: Passage,
  rng: Rng,
): CommentaryEvent[] {
  const firstHalf = match.half === 1;
  const side = possessionSide;
  const clubId = sideClubId(match, side);
  const players = onPitch(match, env, side);

  const sink: Array<{ sortKey: number; line: Omit<CommentaryEvent, 'id'> }> = [];

  const own = (event: MatchEvent): boolean => event.clubId === clubId;
  const attacking = events.filter(
    (event) =>
      own(event) &&
      ['goal', 'penalty-scored', 'penalty-missed', 'shot-saved', 'shot-blocked', 'shot-off-target', 'chance'].includes(
        event.type,
      ),
  );
  const key = attacking[0] ?? null;
  const keyIndex = key ? events.indexOf(key) : -1;

  // The passage runs up to the moment it produced, or stands alone on a quiet minute.
  const base = key ? keyIndex - 0.9 : -1;
  passageLines(match, env, side, passage, rng).forEach((line, index) => {
    sink.push({
      sortKey: base + index * 0.1,
      line: {
        minute: match.minute,
        firstHalf,
        category: line.category,
        priority: line.priority,
        kind: null,
        text: line.text,
        x: line.x,
        y: line.y,
        scoreAfter: null,
        playerId: line.playerId,
        // The line is about the side its own step belonged to, which is not
        // always the side the minute ended up being about.
        side: line.side,
        progress: line.progress,
      },
    });
  });

  // Nothing at all this minute and no move either: fall back to the eleven.
  if (sink.length === 0 && players.length > 1 && rng.chance(0.7)) {
    const passer = rng.pick(players);
    const receiver = rng.pick(players.filter((entry) => entry.player.id !== passer.player.id));
    if (receiver) {
      sink.push({
        sortKey: -1,
        line: {
          minute: match.minute,
          firstHalf,
          side,
          category: 'passing',
          priority: 'routine',
          kind: null,
          text: rng.pick([
            `${surname(passer.player)} keeps it simple and finds ${surname(receiver.player)}.`,
            `${env.clubShortName(clubId)} work it across midfield to ${surname(receiver.player)}.`,
            `${surname(receiver.player)} drops deep to take it off ${surname(passer.player)}.`,
          ]),
          x: 0.5,
          y: rng.float(0.2, 0.8),
          scoreAfter: null,
          playerId: receiver.player.id,
        },
      });
    }
  }

  // Every other event in the minute, in the order it happened. The key attack is
  // told by its passage above; the rest are told as themselves.
  events.forEach((event, index) => {
    if (event === key) {
      sink.push({
        sortKey: index,
        line: {
          minute: match.minute,
          firstHalf,
          side: event.clubId === match.homeClubId ? 'home' : event.clubId === match.awayClubId ? 'away' : null,
          category: keyCategory(event.type),
          priority: keyPriority(event.type),
          kind: KIND_LABEL[event.type] ?? null,
          text: event.text,
          x: event.x,
          y: event.y,
          scoreAfter: event.type === 'goal' || event.type === 'own-goal' || event.type === 'penalty-scored' ? event.scoreAfter : null,
          playerId: event.playerId,
        },
      });
      // The celebration belongs to the moment the ball went in, so it is told
      // right after the finish and ahead of whatever else the minute held.
      if (event.type === 'goal' || event.type === 'own-goal' || event.type === 'penalty-scored') {
        celebrationLines(match, env, event, rng).forEach((line, order) => {
          sink.push({ sortKey: index + 0.1 + order * 0.05, line });
        });
      }
      return;
    }
    if (['half-time', 'full-time', 'kick-off'].includes(event.type)) return;
    sink.push({
      sortKey: index,
      line: {
        minute: match.minute,
        firstHalf,
        side: event.clubId === match.homeClubId ? 'home' : event.clubId === match.awayClubId ? 'away' : null,
        category: eventCategory(event.type),
        priority: eventPriority(event.type),
        kind: KIND_LABEL[event.type] ?? null,
        text: event.text,
        x: event.x,
        y: event.y,
        scoreAfter: null,
        playerId: event.playerId,
      },
    });
  });

  sink.sort((a, b) => a.sortKey - b.sortKey);
  const count = match.commentary?.length ?? 0;
  return sink.map((entry, index) => ({
    id: `${match.id}_c${count + index + 1}`,
    ...entry.line,
  }));
}

function keyCategory(type: MatchEvent['type']): CommentaryCategory {
  switch (type) {
    case 'goal':
    case 'own-goal':
    case 'penalty-scored':
    case 'penalty-missed':
      return 'major';
    case 'shot-saved':
      return 'keeper';
    case 'shot-blocked':
      return 'challenge';
    case 'shot-off-target':
      return 'chance';
    default:
      return 'chance';
  }
}

function keyPriority(type: MatchEvent['type']): CommentaryPriority {
  switch (type) {
    case 'goal':
    case 'own-goal':
    case 'penalty-scored':
    case 'penalty-missed':
      return 'major';
    case 'shot-saved':
      return 'important';
    case 'shot-blocked':
      return 'contextual';
    case 'shot-off-target':
      return 'developing';
    default:
      return 'contextual';
  }
}

function eventCategory(type: MatchEvent['type']): CommentaryCategory {
  switch (type) {
    case 'yellow-card':
    case 'red-card':
    case 'foul':
      return 'challenge';
    case 'corner':
    case 'offside':
      return 'dead-ball';
    case 'substitution':
    case 'injury':
      return 'period';
    default:
      return 'possession';
  }
}

function eventPriority(type: MatchEvent['type']): CommentaryPriority {
  switch (type) {
    case 'red-card':
    case 'yellow-card':
    case 'substitution':
    case 'injury':
      return 'important';
    case 'foul':
    case 'corner':
    case 'offside':
      return 'contextual';
    default:
      return 'routine';
  }
}

/** A line that belongs to the match rather than to a minute: weather, whistles. */
export function makeCommentaryLine(
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
 * Append to the match's own record, creating it the first time.
 *
 * Ids are handed out here rather than at the point of writing, so a batch of
 * lines added together is numbered in the order it will be read.
 */
export function recordCommentary(match: Match, lines: CommentaryEvent[]): void {
  if (lines.length === 0) return;
  const base = match.commentary?.length ?? 0;
  const next = lines.map((line, index) => ({ ...line, id: `${match.id}_c${base + index + 1}` }));
  match.commentary = [...(match.commentary ?? []), ...next];
}

/**
 * Deal a minute's words out among the chains that will play them.
 *
 * The minute is written in one go but played in several, and the bar has to say
 * what is happening rather than what has been decided. Each line is handed to
 * the chain whose slice of the minute it belongs to, using the very `progress`
 * the narrator already wrote — the fraction of the move the line describes —
 * resolved against the chains' own lengths. Each chain then tells its share at
 * the moment it takes the pitch, so a line about a pass is said as that pass is
 * being played rather than a minute before it.
 *
 * A line that does not know where it belongs — a foul, a card, a note — goes
 * with the line before it, because it interrupts the move it was written
 * against rather than starting one of its own.
 */
export function splitCommentaryByChain(
  chains: readonly ChainSlice[],
  lines: readonly CommentaryEvent[],
): CommentaryEvent[][] {
  const buckets: CommentaryEvent[][] = chains.map(() => []);
  if (chains.length === 0) return buckets;

  // The chains' own lengths, so a third of the minute's football is given a
  // third of the minute's words rather than an equal share of each.
  const total = chains.reduce((sum, chain) => sum + Math.max(0, chain.seconds), 0);

  let carried = 0;
  for (const line of lines) {
    if (total <= 0 || typeof line.progress !== 'number') {
      buckets[carried]!.push(line);
      continue;
    }
    const at = Math.min(Math.max(line.progress, 0), 1) * total;
    let passed = 0;
    let index = chains.length - 1;
    for (let position = 0; position < chains.length; position += 1) {
      passed += Math.max(0, chains[position]!.seconds);
      if (at <= passed) {
        index = position;
        break;
      }
    }
    buckets[index]!.push(line);
    carried = index;
  }
  return buckets;
}

/** Whose half it was, for callers that need the label rather than the line. */
export function sides(): Side[] {
  return SIDES;
}
