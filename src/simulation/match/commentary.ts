import type { PitchCondition, Weather } from '@/domain/match';
import type { Player } from '@/domain/person';

/**
 * Commentary is generated from structured facts (who, what, where, when) using
 * a bank of templates. Nothing here invents facts that did not happen: the
 * engine decides the event, the writer decides only how to say it.
 *
 * This is deliberately the seed of the procedural writing system the design
 * document describes — journalists and post-match reports reuse the same idea.
 */

export interface CommentaryContext {
  player?: Player | null;
  partner?: Player | null;
  teamName: string;
  opponentName: string;
  minute: number;
  score: string;
  /** 0..1 how good the shot was. */
  quality?: number;
  rngPick: <T>(items: readonly T[]) => T;
}

function nameOf(player: Player | null | undefined): string {
  if (!player) return 'somebody';
  return player.surname;
}

function fullNameOf(player: Player | null | undefined): string {
  if (!player) return 'somebody';
  return player.nickname ? `${player.firstName} '${player.nickname}' ${player.surname}` : `${player.firstName} ${player.surname}`;
}

export function writeKickOff(homeName: string, awayName: string, pitch: PitchCondition): string {
  if (pitch === 'muddy' || pitch === 'waterlogged') {
    return `${homeName} get us underway. The pitch is a state — heavy going straight away.`;
  }
  if (pitch === 'frozen') {
    return `Kick-off on a rock-hard surface. Both sides will feel every tackle today.`;
  }
  return `${homeName} kick off against ${awayName}.`;
}

export function writeHalfTime(homeScore: number, awayScore: number): string {
  if (homeScore === 0 && awayScore === 0) {
    return 'Half-time. Goalless and scrappy, but there is a game in this yet.';
  }
  return `Half-time: ${homeScore}-${awayScore}. Time for a breather and a word or two.`;
}

export function writeFullTime(homeScore: number, awayScore: number): string {
  return `Full-time: ${homeScore}-${awayScore}.`;
}

export function writeGoal(ctx: CommentaryContext): string {
  const scorer = nameOf(ctx.player);
  const assist = nameOf(ctx.partner);
  const templates = [
    `GOAL! ${scorer} buries it. ${ctx.teamName} lead the celebrations.`,
    `${scorer} scores! It's ${ctx.score} now.`,
    `GOAL! ${assist} picks out ${scorer}, who makes no mistake.`,
    `${scorer} finishes it off — ${ctx.score}.`,
    `GOAL! ${scorer} gets across his man and it's in.`,
    `That's a fine finish from ${scorer}. ${ctx.score}.`,
  ];
  if (ctx.partner) {
    return ctx.rngPick([templates[2]!, templates[0]!, templates[3]!, templates[1]!]);
  }
  return ctx.rngPick([templates[0]!, templates[1]!, templates[3]!, templates[4]!, templates[5]!]);
}

export function writePenaltyScored(ctx: CommentaryContext): string {
  return `Penalty to ${ctx.teamName} — and ${nameOf(ctx.player)} puts it away. ${ctx.score}.`;
}

export function writePenaltyMissed(ctx: CommentaryContext): string {
  return `Penalty to ${ctx.teamName}, and ${nameOf(ctx.player)} misses it. The keeper is delighted.`;
}

export function writeSaved(ctx: CommentaryContext): string {
  const shooter = nameOf(ctx.player);
  const keeper = nameOf(ctx.partner);
  const good = (ctx.quality ?? 0.5) > 0.62;
  const templates = good
    ? [
        `${shooter} forces a superb save from ${keeper}.`,
        `Great chance for ${shooter} — ${keeper} gets a strong hand to it.`,
        `${keeper} somehow keeps ${shooter}'s effort out.`,
      ]
    : [
        `${shooter} works ${keeper} with a routine effort.`,
        `Straight at ${keeper} from ${shooter}.`,
        `${shooter} shoots, saved comfortably by ${keeper}.`,
      ];
  return ctx.rngPick(templates);
}

export function writeOffTarget(ctx: CommentaryContext): string {
  const shooter = nameOf(ctx.player);
  const templates = [
    `${shooter} blazes it over.`,
    `Wide from ${shooter}. He knows he should have hit the target.`,
    `${shooter} snatches at it and it sails into the trees.`,
    `Over the bar from ${shooter} — the ball is still going.`,
    `${shooter} drags it wide of the far post.`,
  ];
  return ctx.rngPick(templates);
}

export function writeBlocked(ctx: CommentaryContext): string {
  const shooter = nameOf(ctx.player);
  const blocker = nameOf(ctx.partner);
  const templates = [
    `${shooter} shoots, blocked bravely by ${blocker}.`,
    `${blocker} throws himself in front of ${shooter}'s effort.`,
    `Deflected away — ${blocker} got a touch on ${shooter}'s shot.`,
  ];
  return ctx.rngPick(templates);
}

export function writeFoul(ctx: CommentaryContext): string {
  const offender = nameOf(ctx.player);
  const victim = nameOf(ctx.partner);
  const templates = [
    `Free kick against ${offender} for a trip on ${victim}.`,
    `${offender} clatters into ${victim} — free kick.`,
    `Strong challenge by ${offender}. Referee gives it.`,
    `${victim} goes down and ${offender} is the man penalised.`,
    `Shirt pull by ${offender}. Simple decision.`,
  ];
  return ctx.rngPick(templates);
}

export function writeYellow(ctx: CommentaryContext): string {
  const player = nameOf(ctx.player);
  const templates = [
    `Yellow card for ${player}.`,
    `${player} goes into the book — a bit of a clumsy one.`,
    `Booking for ${player}. He's not happy about it.`,
    `${player} is cautioned. No complaints from the dugout.`,
  ];
  return ctx.rngPick(templates);
}

export function writeSecondYellow(ctx: CommentaryContext): string {
  return `Second yellow for ${nameOf(ctx.player)} — he's off. ${ctx.teamName} down to ten.`;
}

export function writeRed(ctx: CommentaryContext): string {
  return `Straight red for ${nameOf(ctx.player)}. ${ctx.teamName} will finish this with ten men.`;
}

export function writeInjury(ctx: CommentaryContext): string {
  const player = fullNameOf(ctx.player);
  const templates = [
    `${player} is down and staying down. That looks like a problem.`,
    `${player} pulls up. He signals straight to the bench.`,
    `Trouble for ${player} — twisted awkwardly in the tackle.`,
    `${player} limps away from that one.`,
  ];
  return ctx.rngPick(templates);
}

export function writeSubstitution(onName: string, offName: string, clubName: string): string {
  return `${clubName} change: ${onName} replaces ${offName}.`;
}

export function writeChance(ctx: CommentaryContext): string {
  const player = nameOf(ctx.player);
  const templates = [
    `${player} is in behind — but the flag is up.`,
    `${player} hesitates and the chance goes.`,
    `Half a chance for ${player}, and it's scrambled clear.`,
  ];
  return ctx.rngPick(templates);
}

export function writeWeatherNote(weather: Weather, pitch: PitchCondition, windMph: number): string {
  const weatherLine: Record<Weather, string> = {
    clear: 'Bright and still enough for football.',
    overcast: 'Grey and still.',
    windy: `Windy — the flag on the corner is horizontal at ${Math.round(windMph)}mph.`,
    'light-rain': 'Light drizzle, the sort that soaks you by the hour mark.',
    'heavy-rain': 'Persistent rain. Nobody is staying dry today.',
    cold: 'Cold enough that the warm-up mattered.',
    frozen: 'Bitterly cold with a frozen crust on the surface.',
  };
  const pitchLine: Record<PitchCondition, string> = {
    excellent: 'The pitch is in better nick than anyone expected.',
    good: 'The surface looks fine.',
    worn: 'The pitch is worn in the middle already.',
    muddy: 'It is heavy and cutting up badly.',
    waterlogged: 'Standing water in the corners.',
    frozen: 'The surface is hard as a rock.',
  };
  return `${weatherLine[weather]} ${pitchLine[pitch]}`;
}

export const INCIDENT_POOL: Array<(homeName: string, awayName: string) => string> = [
  (home) => `${home}'s chairman is still putting the nets up twenty minutes before kick-off.`,
  (_home, away) => `${away} arrive late after getting stuck behind a tractor on the lane.`,
  (home) => `${home} are short of corner flags; a broom handle does the job on the far side.`,
  (_home, away) => `Kit clash spotted — ${away} change into the spare set from the boot of a car.`,
  (home) => `A dog escapes onto the pitch during the warm-up at ${home}. Forty seconds of chaos, one happy dog.`,
  (home) => `The ref is doing the ${home} game on his own — no club assistants turned up.`,
  (home) => `${home}'s keeper has left his gloves at home and borrows a pair from the opposition.`,
  (_home, away) => `${away} only have eleven. Two players are still driving over from work.`,
];
