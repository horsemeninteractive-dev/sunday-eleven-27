import type { Player } from '@/domain/person';
import { clampSystemFamiliarity } from '@/domain/person';

/**
 * The last half hour before kick-off.
 *
 * A team talk and a warm-up are not stat buffs: they are a manager saying
 * something to a room of people, most of whom he has known for years. So the
 * effect here is small, it depends on the man hearing it, and somebody in every
 * squad takes it the wrong way. Nothing is reported as a number to the manager
 * — he is told how it landed, the way he would be told on the touchline.
 */

export type TeamTalk = 'calm' | 'focused' | 'motivational' | 'aggressive' | 'confident' | 'cautious';
export type WarmUp = 'light' | 'normal' | 'intense' | 'tactical';

/**
 * What is said once it is over.
 *
 * A full-time word is not the same speech as a pre-match one: it has a result
 * behind it, and every man in the room knows what he did out there. So these
 * are judged against how the team went and how the individual played — praising
 * a lad who knows he had a shocker rings hollow, and shouting at somebody who
 * was the best player on the pitch does not land at all.
 */
export type FullTimeTalk = 'praise' | 'measured' | 'blast' | 'console' | 'nothing';

export const TEAM_TALK_ORDER: TeamTalk[] = ['calm', 'focused', 'motivational', 'aggressive', 'confident', 'cautious'];

export const TEAM_TALK_LABEL: Record<TeamTalk, string> = {
  calm: 'Calm',
  focused: 'Focused',
  motivational: 'Rousing',
  aggressive: 'Aggressive',
  confident: 'Confident',
  cautious: 'Cautious',
};

export const TEAM_TALK_BLURB: Record<TeamTalk, string> = {
  calm: 'No speeches. Remind them what they are good at and send them out.',
  focused: 'One or two jobs each, plainly stated. Nothing else.',
  motivational: 'Tell them what ninety minutes of effort is worth to this club.',
  aggressive: 'Raise your voice. Some of them need it. Some of them will not like it.',
  confident: 'Tell them the game is theirs to lose. Back them publicly.',
  cautious: 'Respect the opposition, keep it tight early, take nothing for granted.',
};

export const WARM_UP_ORDER: WarmUp[] = ['light', 'normal', 'intense', 'tactical'];

export const WARM_UP_LABEL: Record<WarmUp, string> = {
  light: 'Light',
  normal: 'Normal',
  intense: 'Intense',
  tactical: 'Tactical rehearsal',
};

export const WARM_UP_BLURB: Record<WarmUp, string> = {
  light: 'A stretch and a jog. Fresh legs, but slow to the pace of it.',
  normal: 'The usual: short sharp work, a few patterns, then in.',
  intense: 'Properly worked. They will start sharp and tire sooner for it.',
  tactical: 'Walk the shape and the set pieces. Costing them a little in the legs.',
};

/**
 * How much a player's morale moves at hearing this talk.
 *
 * Kept to a couple of points either way: a Sunday league dressing room is not
 * reorganised by a speech, but the wrong words to the wrong bloke do land.
 */
export function teamTalkMoraleDelta(talk: TeamTalk, player: Player): number {
  const { attributes, personality } = player;
  const determination = attributes.mental.determination;
  const commitment = attributes.behavioural.commitment;
  const composure = attributes.mental.composure;
  const ambition = attributes.behavioural.ambition;
  const temperament = attributes.hidden.temperament;
  const quiet = personality === 'Quiet' || personality === 'Laid back';
  const fierce = personality === 'Competitive' || personality === 'Hot-headed' || personality === 'Wind-up merchant';

  switch (talk) {
    case 'calm':
      // Steadies the ones who play on their nerves; nothing to say to the rest.
      return temperament >= 14 ? 1 : 0;
    case 'focused':
      if (determination >= 12) return 1;
      if (quiet) return -1;
      return 0;
    case 'motivational':
      if (commitment >= 12) return 2;
      if (quiet) return 1;
      return 1;
    case 'aggressive':
      if (fierce && composure >= 10) return 2;
      if (quiet) return -2;
      if (composure < 8) return -1;
      return 1;
    case 'confident':
      if (ambition >= 12 && composure >= 9) return 1;
      if (composure < 8) return -1;
      return 0;
    case 'cautious':
      if (ambition >= 14) return -1;
      if (composure >= 13) return 1;
      return 0;
  }
}

export const FULL_TIME_TALK_ORDER: FullTimeTalk[] = ['praise', 'measured', 'blast', 'console', 'nothing'];

export const FULL_TIME_TALK_LABEL: Record<FullTimeTalk, string> = {
  praise: 'Praise them',
  measured: 'Measured',
  blast: 'Blast them',
  console: 'Console them',
  nothing: 'Say nothing',
};

/** How he would put it back to himself, an hour later. */
export const FULL_TIME_TALK_SAID: Record<FullTimeTalk, string> = {
  praise: 'You told them it was good',
  measured: 'You kept it measured',
  blast: 'You told them exactly what that was',
  console: 'You picked them up',
  nothing: 'You said nothing',
};

export const FULL_TIME_TALK_BLURB: Record<FullTimeTalk, string> = {
  praise: 'Tell them that was good — genuinely good — and send them home happy.',
  measured: 'Name what worked, name what did not, and leave it there.',
  blast: 'Tell them exactly what that was. Loudly. Some will need it; some will not.',
  console: 'Pick them up. A bad afternoon is not the same as a bad team.',
  nothing: 'Say nothing. Let them work it out on the drive home.',
};

export interface FullTimeContext {
  /** How the manager's own side got on. */
  result: 'win' | 'draw' | 'loss';
  /** Goals in it, from his side's point of view, always zero or more. */
  margin: number;
  /** The player's match rating, or null when he did not get on. */
  rating: number | null;
}

/**
 * The result as the manager's own side saw it.
 *
 * Read from the scoreline rather than from the match result record, because at
 * full time he is standing in the middle of the pitch, not reading a table.
 */
export function fullTimeOutcome(
  score: { home: number; away: number },
  side: 'home' | 'away',
): Pick<FullTimeContext, 'result' | 'margin'> {
  const mine = side === 'home' ? score.home : score.away;
  const theirs = side === 'home' ? score.away : score.home;
  return {
    result: mine > theirs ? 'win' : mine === theirs ? 'draw' : 'loss',
    margin: Math.abs(mine - theirs),
  };
}

/**
 * How much a player's morale moves at hearing the full-time word.
 *
 * A couple of points either way, decided by the result and by how the man
 * himself played — the same as any dressing room on a Sunday evening.
 */
export function fullTimeTalkMoraleDelta(talk: FullTimeTalk, player: Player, context: FullTimeContext): number {
  const { result, margin, rating } = context;
  const { personality, attributes } = player;
  const determination = attributes.mental.determination;
  const composure = attributes.mental.composure;
  const quiet = personality === 'Quiet' || personality === 'Laid back';
  const fierce = personality === 'Competitive' || personality === 'Hot-headed' || personality === 'Wind-up merchant';
  const playedWell = rating !== null && rating >= 7;
  const playedBadly = rating !== null && rating < 6;

  switch (talk) {
    case 'praise':
      if (playedWell) return 2;
      if (playedBadly) return -1;
      return result === 'win' ? 1 : 0;
    case 'measured':
      if (playedWell) return 1;
      if (playedBadly) return -1;
      return 0;
    case 'blast':
      // Shouting after a win is baffling, however it went out there.
      if (result === 'win' && margin > 0) return -2;
      if (playedWell) return -1;
      if (playedBadly) return determination >= 13 ? 1 : quiet ? -2 : -1;
      return fierce && composure >= 10 ? 1 : -1;
    case 'console':
      if (result === 'win') return -1;
      if (result === 'draw') return 0;
      if (playedWell) return 1;
      return player.morale < 55 ? 1 : 0;
    case 'nothing':
      // Silence after a hiding is not neutral: it curdles.
      return result === 'loss' && margin >= 2 ? -1 : 0;
  }
}

/** What the manager is told afterwards — how it landed in the room. */
export function teamTalkVerdict(talk: TeamTalk, deltas: number[]): string {
  const moved = deltas.filter((delta) => delta > 0).length;
  const wounded = deltas.filter((delta) => delta < 0).length;
  if (wounded === 0 && moved === 0) return `${TEAM_TALK_LABEL[talk]} words. Heads nodded, nothing more.`;
  if (wounded === 0) return `${TEAM_TALK_LABEL[talk]} words. It landed well.`;
  if (moved === 0) return `${TEAM_TALK_LABEL[talk]} words. One or two did not want to hear it.`;
  if (wounded >= deltas.length / 2) return `${TEAM_TALK_LABEL[talk]} words. It split the room.`;
  return `${TEAM_TALK_LABEL[talk]} words. Most of them took it; a couple went quiet.`;
}

/** The full-time word, as the manager would be told it went. */
export function fullTimeTalkVerdict(talk: FullTimeTalk, deltas: number[], result: 'win' | 'draw' | 'loss'): string {
  const said = FULL_TIME_TALK_SAID[talk];
  const moved = deltas.filter((delta) => delta > 0).length;
  const wounded = deltas.filter((delta) => delta < 0).length;
  if (talk === 'nothing') {
    return result === 'loss' ? 'Nobody said much. The coach went home quiet.' : 'Nothing was said. Nobody minded.';
  }
  if (wounded === 0 && moved === 0) return `${said}. It went in, and out again.`;
  if (wounded === 0) return `${said}. It landed well.`;
  if (moved === 0) return `${said}. A few of them did not want to hear it.`;
  if (wounded >= deltas.length / 2) return `${said}. It split the dressing room.`;
  return `${said}. Most took it; a couple went quiet.`;
}

/** Energy the warm-up leaves in their legs, before a ball is kicked. */
export function warmUpEnergyDelta(warmUp: WarmUp): number {
  switch (warmUp) {
    case 'light':
      return 2;
    case 'normal':
      return 0;
    case 'intense':
      return -4;
    case 'tactical':
      return -2;
  }
}

/** Shape familiarity the tactical rehearsal leaves behind, if any. */
export function warmUpFamiliarityDelta(warmUp: WarmUp): number {
  return warmUp === 'tactical' ? 0.3 : 0;
}

export function applyWarmUpToFamiliarity(warmUp: WarmUp, player: Player): void {
  const delta = warmUpFamiliarityDelta(warmUp);
  if (delta === 0) return;
  player.systemFamiliarity = {
    ...player.systemFamiliarity,
    formation: clampSystemFamiliarity(player.systemFamiliarity.formation + delta),
  };
}
