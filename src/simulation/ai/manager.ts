import type { PositionCode } from '@/domain/positions';
import type { DefensiveLine, Mentality, Tactics, Tempo } from '@/domain/tactics';
import type { Role } from '../match/roles';
import type { ClubStyle } from './style';

/**
 * The man in the other dugout.
 *
 * Phase 1 gave a club instructions; it never gave it a manager. Every AI side
 * set out the same way it had been told to in August and then did nothing at
 * all for ninety minutes — the scoreline, the clock and a sending-off were all
 * information the simulation held and no one acted on. This is the layer that
 * reads them and decides.
 *
 * Three things are worth being explicit about, because they are what keeps it
 * honest:
 *
 *  - **It is judgement, not football.** Nothing here touches a ball, a player
 *    or the engine's state. It answers three questions — what instructions
 *    should this side be playing, should somebody come off, and who should come
 *    on — and hands the answers to whichever resolution is playing the match.
 *  - **It is shared.** The detailed engine and the abstract one both call
 *    these functions, so a manager's afternoon is the same football whether the
 *    fixture was watched or not. There is one AI manager, not two.
 *  - **It is deterministic.** No rolls, no hidden state: the same scoreline,
 *    clock and squad always produce the same decision. Randomness belongs to the
 *    football, and a manager who changed his mind on a coin toss would make the
 *    two resolutions disagree the moment their streams diverged.
 *
 * The rules are the ones a Sunday manager actually uses, and they are
 * deliberately few: go for it when you are losing late, shut it down when you
 * are winning late, take the point when you are outclassed and level, and
 * rearrange everything when you are a man down. What makes two sides different
 * is not the rules but the men applying them — an ambitious, flexible manager
 * pushes further and sooner than a cautious one, and a side with nothing up
 * front does not try to out-football a better team.
 */

/** What the manager can see from the touchline. */
export interface MatchSituation {
  /** Minutes played, 1-based. */
  minute: number;
  scoreFor: number;
  scoreAgainst: number;
  /** Own strength against the opposition's; 1 is even. */
  strengthRatio: number;
  /** Men fewer than the opposition (0 when even). */
  menDown: number;
  /** Changes still available to him. */
  changesLeft: number;
  benchSize: number;
  /** Whether he is the home manager. */
  home: boolean;
}

/** What he wants from his bench for the rest of the afternoon. */
export type BenchIntent = 'none' | 'refresh' | 'chase' | 'protect';

/** What the manager has decided, as a set of instructions to send on. */
export interface Reaction {
  /** Only the instructions that *change*; empty when he is happy as he is. */
  tactics: Partial<Tactics>;
  benchIntent: BenchIntent;
  /** A clause the touchline can print: "Hanwell have <reason>." */
  reason: string | null;
}

const MENTALITY_STEPS: Mentality[] = ['very-defensive', 'defensive', 'balanced', 'attacking', 'very-attacking'];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * How far this manager is prepared to push.
 *
 * Ambition and flexibility together decide how many rungs of the mentality
 * ladder he is willing to climb when he is behind, and how early. A cautious,
 * rigid side losing 1-0 in the 70th minute changes almost nothing; an ambitious
 * one is already on the front foot and will go two steps.
 */
function pushAllowance(style: ClubStyle): number {
  return 1 + (style.ambition > 0.58 ? 1 : 0) + (style.flexibility > 0.62 ? 1 : 0);
}

/** How far he is prepared to retreat when he is ahead. */
function holdAllowance(style: ClubStyle): number {
  return 1 + (style.ambition < 0.42 ? 1 : 0);
}

const LINE_FOR_PUSH: DefensiveLine[] = ['deep', 'standard', 'high'];
const TEMPO_FOR_PUSH: Tempo[] = ['slow', 'standard', 'high'];

function nudge<T extends string>(order: readonly T[], current: T, by: number): T {
  const index = order.indexOf(current);
  const next = clamp((index < 0 ? 1 : index) + by, 0, order.length - 1);
  return order[next]!;
}

/**
 * What a manager does about the way the game is going.
 *
 * Called on a slow cadence during a match, and deliberately *not* every minute:
 * a manager who reacts to every kick is not a manager. The caller decides how
 * often to ask; this decides what the answer is.
 */
export function matchReaction(style: ClubStyle, situation: MatchSituation, current: Tactics): Reaction {
  const { minute, scoreFor, scoreAgainst, menDown } = situation;
  const lead = scoreFor - scoreAgainst;
  const late = minute >= 60;
  const veryLate = minute >= 75;
  const endgame = minute >= 84;
  const interval = minute >= 44 && minute <= 47;
  const tactics: Partial<Tactics> = {};
  let reason: string | null = null;

  if (menDown > 0) {
    // A man down is a different match, and it is the one decision a manager
    // makes whatever the clock says. The shape is the engine's business — it
    // already plays the ten men it has — but the *plan* has to change: nobody
    // presses high with ten men, and the line drops.
    const guarded = Math.min(2, menDown);
    const target = clamp(MENTALITY_STEPS.indexOf(style.mentality) - guarded, 0, 4);
    const wanted = veryLate && lead < 0 ? Math.max(target, 2) : target;
    tactics.mentality = MENTALITY_STEPS[wanted]!;
    tactics.defensiveLine = 'deep';
    tactics.pressing = 'low';
    if (tactics.mentality !== current.mentality || current.defensiveLine !== 'deep' || current.pressing !== 'low') {
      reason = lead > 0 ? 'have shut up shop with ten men' : 'have gone deep and compact with ten men';
    }
    return { tactics, benchIntent: lead >= 0 ? 'protect' : 'chase', reason };
  }

  // Nothing before the half-hour: a manager does not rebuild a side because it
  // is a goal down in the twelfth minute. The interval is the exception, and it
  // is the most valuable few minutes he gets.
  if (minute < 30 && !interval) {
    return { tactics, benchIntent: 'refresh', reason: null };
  }

  const allowance = pushAllowance(style);
  const base = MENTALITY_STEPS.indexOf(style.mentality);

  if (lead < 0) {
    const chasing = late || interval;
    if (!chasing && !veryLate) {
      // Early, and behind: he says something, but he does not turn the game on
      // its head. One step, and only if he is the sort of manager who does.
      if (style.flexibility > 0.6 && interval) {
        const target = Math.max(base, MENTALITY_STEPS.indexOf(current.mentality) + 1);
        tactics.mentality = MENTALITY_STEPS[Math.min(target, base + allowance)]!;
        reason = reason ?? 'have changed it at half-time';
      }
      return { tactics, benchIntent: changesWanted(situation, 'chase'), reason };
    }
    const urgency = lead <= -2 || (veryLate && style.ambition > 0.5) ? 2 : 1;
    const target = Math.min(MENTALITY_STEPS.indexOf(current.mentality) + urgency, base + allowance, 4);
    tactics.mentality = MENTALITY_STEPS[target]!;
    tactics.defensiveLine = nudge(LINE_FOR_PUSH, current.defensiveLine, 1);
    tactics.tempo = nudge(TEMPO_FOR_PUSH, current.tempo, 1);
    if (veryLate || endgame) tactics.pressing = 'high';
    reason = endgame && lead <= -2 ? 'have thrown everything forward' : 'have gone more attacking';
    return { tactics, benchIntent: changesWanted(situation, 'chase'), reason };
  }

  if (lead > 0) {
    const protecting = minute >= (lead >= 2 ? 55 : 68) || interval;
    if (!protecting) return { tactics, benchIntent: 'refresh', reason: null };
    const drop = lead >= 2 ? 2 : 1;
    const hold = holdAllowance(style);
    const target = Math.max(MENTALITY_STEPS.indexOf(current.mentality) - Math.min(drop, hold), base - hold, 0);
    tactics.mentality = MENTALITY_STEPS[target]!;
    if (current.defensiveLine !== 'deep') tactics.defensiveLine = nudge(LINE_FOR_PUSH, current.defensiveLine, -1);
    if (current.tempo !== 'slow') tactics.tempo = nudge(TEMPO_FOR_PUSH, current.tempo, -1);
    if (current.pressing !== 'low') tactics.pressing = nudge(['low', 'medium', 'high'] as const, current.pressing, -1);
    reason = lead >= 2 ? 'have the game where they want it' : 'have dropped deeper to protect the lead';
    return { tactics, benchIntent: changesWanted(situation, 'protect'), reason };
  }

  // Level. What he does about a draw depends entirely on whether he should be
  // winning it — the same minute means different things to the leaders and to
  // the side that has not had a kick.
  const stronger = situation.strengthRatio > 1.06;
  const outclassed = situation.strengthRatio < 0.92;
  if (endgame && stronger && style.ambition > 0.45) {
    tactics.mentality = MENTALITY_STEPS[Math.min(MENTALITY_STEPS.indexOf(current.mentality) + 1, base + allowance, 4)]!;
    tactics.defensiveLine = nudge(LINE_FOR_PUSH, current.defensiveLine, 1);
    reason = 'have gone for it';
    return { tactics, benchIntent: changesWanted(situation, 'chase'), reason };
  }
  if (veryLate && outclassed && changesWanted(situation, 'protect') !== 'none') {
    tactics.mentality = MENTALITY_STEPS[Math.max(MENTALITY_STEPS.indexOf(current.mentality) - 1, 0)]!;
    tactics.tempo = nudge(TEMPO_FOR_PUSH, current.tempo, -1);
    reason = 'will take the point';
    return { tactics, benchIntent: 'protect', reason };
  }
  return { tactics, benchIntent: 'refresh', reason: null };
}

function changesWanted(situation: MatchSituation, intent: BenchIntent): BenchIntent {
  if (situation.changesLeft <= 0 || situation.benchSize <= 0) return 'none';
  return intent;
}

/** One man warming up, as a bench decision sees him. */
export interface BenchCandidate {
  playerId: string;
  position: PositionCode;
  /** How familiar he is with the slot he would be filling, 0..1. */
  familiarity: number;
  /** In-match energy (or weekly fitness before kick-off), 0..100. */
  energy: number;
  /** How attacking his position is: 1 is a centre forward, 0 a centre half. */
  attacking: number;
  /** How good he is at the job being asked, 0..1 — attributes, not reputation. */
  fit: number;
}

/** The slot being filled, so the bench knows what is being asked. */
export interface OutgoingSlot {
  position: PositionCode;
  role: Role;
}

/**
 * Who comes on.
 *
 * `fit` and `familiarity` are what make it a football decision rather than a
 * lottery: a substitute who can do the job he is being sent on to do beats a
 * better player who cannot. The intent then tilts it — chasing a game is a
 * centre forward, protecting one is a defender — and freshness breaks the tie,
 * because a manager bringing somebody on at 80 minutes does not want a man as
 * tired as the one coming off.
 */
export function pickBenchMan(
  intent: BenchIntent,
  outgoing: OutgoingSlot,
  candidates: readonly BenchCandidate[],
): string | null {
  if (candidates.length === 0) return null;
  const keeper = outgoing.position === 'GK';
  const pool = keeper ? candidates.filter((candidate) => candidate.familiarity > 0.3) : candidates;
  if (pool.length === 0) return null;

  let best: { playerId: string; score: number } | null = null;
  for (const candidate of pool) {
    let score = candidate.fit * 2.4 + candidate.familiarity * 1.3 + candidate.energy / 90;
    if (intent === 'chase') score += candidate.attacking * 1.9;
    else if (intent === 'protect') score += (1 - candidate.attacking) * 1.9;
    else score += (candidate.position === outgoing.position ? 0.6 : 0) + candidate.energy / 140;
    // A change made for its own sake is worse than no change: a bench man who
    // is not fit for the job has to be clearly the best option to get on.
    if (candidate.fit < 0.3 && !keeper) score -= 0.8;
    if (!best || score > best.score) best = { playerId: candidate.playerId, score };
  }
  return best ? best.playerId : null;
}

/** One man on the pitch, as the manager reads him from the touchline. */
export interface PlayerCondition {
  playerId: string;
  position: PositionCode;
  energy: number;
  /** The engine's own rating of his afternoon so far, 1..10. */
  rating: number;
  booked: boolean;
  /** How attacking his position is: 1 is a centre forward, 0 a centre half. */
  attacking: number;
  injured: boolean;
}

/**
 * Who comes off.
 *
 * Four reasons, in the order a manager would use them: somebody hurt cannot run
 * it off; somebody out of the game on rating is not helping; somebody out of
 * legs is a liability; and when the plan has changed, the man who no longer has
 * a job is the one who goes. The keeper is never one of them unless he is hurt,
 * because a Sunday side does not have a spare.
 */
export function pickOutgoing(
  intent: BenchIntent,
  players: readonly PlayerCondition[],
  minute: number,
): string | null {
  if (players.length === 0) return null;
  const hurt = players.find((player) => player.injured);
  if (hurt) return hurt.playerId;
  if (minute < 45) return null;

  let best: { playerId: string; score: number } | null = null;
  for (const player of players) {
    if (player.position === 'GK') continue;
    let score = (100 - player.energy) * 0.5 + Math.max(0, 6.7 - player.rating) * 16;
    if (player.booked && player.energy < 72) score += 5;
    if (intent === 'chase') score += (1 - player.attacking) * 9;
    else if (intent === 'protect') score += player.attacking * 9;
    // Nobody is pulled off for nothing: the change has to be justified by tired
    // legs, a poor afternoon, or a plan that needs a different kind of player.
    const justified =
      player.energy < 58 ||
      player.rating < 5.6 ||
      (player.booked && player.energy < 72) ||
      ((intent === 'chase' || intent === 'protect') && minute >= 70);
    if (!justified) continue;
    if (!best || score > best.score) best = { playerId: player.playerId, score };
  }
  return best ? best.playerId : null;
}

/** How much of the pitch a position plays in: 1 is a forward, 0 a centre half. */
export function attackingWeightOf(position: PositionCode): number {
  switch (position) {
    case 'GK':
      return 0;
    case 'CB':
      return 0.08;
    case 'RB':
    case 'LB':
      return 0.32;
    case 'DM':
      return 0.34;
    case 'CM':
      return 0.52;
    case 'RM':
    case 'LM':
      return 0.66;
    case 'AM':
      return 0.8;
    case 'RW':
    case 'LW':
      return 0.88;
    case 'ST':
      return 1;
    default:
      return 0.5;
  }
}

/** The mentality a side is playing at, for the read-out and the tests. */
export function mentalityIndex(mentality: Mentality): number {
  return MENTALITY_STEPS.indexOf(mentality);
}
