import type { GameState } from '@/domain/game';
import { ATTRIBUTE_DESCRIPTORS, MAX_ATTRIBUTE, clampAttribute, type AttributeGroup } from '@/domain/attributes';
import type { Player, PlayerDevelopment } from '@/domain/person';
import type { TrainingBlockId, TrainingDecline, TrainingImprovement } from '@/domain/training';
import { stream } from '../rng';
import { DEVELOPMENT_LAST_AGE } from '../generation/playerGenerator';
import { developmentFor } from './store';

/**
 * Getting better.
 *
 * Training does not hand out points. Every session a player accumulates
 * *opportunity* in the things he worked on, and opportunity only occasionally
 * turns into a real, visible improvement — and then only if he is young enough,
 * has room to grow, and is the sort of lad who improves. Most weeks, nothing
 * visibly changes at all, which is exactly how grassroots football feels.
 */

/**
 * Opportunity needed before an improvement is even considered.
 *
 * Half of what it used to be, because a player now only banks opportunity while
 * he is young enough to have any headroom at all — a man past his prime banks
 * nothing whatever, so the gate only ever applies to the lads it should. Left
 * at the old value it took a young player most of a season to move a single
 * point, which is not a curve, it is a rounding error.
 */
const THRESHOLD = 0.5;

/** The attribute groups a man is judged and developed on. */
const OVERALL_GROUPS: readonly AttributeGroup[] = ['technical', 'physical', 'mental'];

/**
 * Training sessions in an average season. Only used to express decline as an
 * annual figure, so a manager can be told "he is losing about half a point a
 * year" and have that be true.
 */
const SESSIONS_PER_SEASON = 33;

/**
 * How fast a man past his peak loses what he has, in attribute points a year.
 *
 * Applied to physical attributes hardest and know-how barely at all, which is
 * what makes an old player a different kind of player rather than simply a
 * worse one.
 */
const DECLINE_PER_SEASON = 0.55;

/** How readily each kind of attribute goes once the legs have gone. */
const DECLINE_WEIGHT: Record<AttributeGroup, number> = {
  physical: 3,
  technical: 1.1,
  mental: 0.4,
  behavioural: 0.2,
  hidden: 0.5,
};

/**
 * The total weight of all the attributes on a player.
 *
 * Decline is applied one attribute at a time, so the annual figure has to be
 * divided by the number of chances at it — otherwise "half a point a year"
 * quietly becomes seventy points a year and every man ends up on the floor of
 * the scale.
 */
const TOTAL_DECLINE_WEIGHT = ATTRIBUTE_DESCRIPTORS.reduce(
  (sum, descriptor) => sum + (DECLINE_WEIGHT[descriptor.group] ?? 0.5),
  0,
);

/** A player's overall level, on the same 1–20 scale as his attributes. */
export function overallAbility(player: Player): number {
  const values: number[] = [];
  for (const group of OVERALL_GROUPS) {
    for (const value of Object.values(player.attributes[group])) values.push(value as number);
  }
  if (values.length === 0) return 10;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * A player's curve, or a sensible one if he has not got a profile.
 *
 * A save from before curves existed, or a state assembled by hand, can hold a
 * player with no `development` block. He is given the default career: a peak in
 * the late twenties, and whatever headroom his age leaves him. Without this a
 * missing profile would read as "he is already as good as he will ever get" and
 * quietly freeze him, which is a far worse failure than a plain assumption.
 */
function profileFor(player: Player): PlayerDevelopment {
  if (player.development && Number.isFinite(player.development.potential)) return player.development;
  const current = overallAbility(player);
  return {
    potential: Math.min(20, current + Math.max(0, DEVELOPMENT_LAST_AGE - player.age) * 0.45),
    peakAge: 27,
  };
}

function groupOf(key: string): AttributeGroup {
  return (key.split('.')[0] ?? 'technical') as AttributeGroup;
}

function keyOf(key: string): string {
  return key.split('.')[1] ?? key;
}

function attributeValueOf(player: Player, key: string): number {
  const bucket = player.attributes[groupOf(key)] as unknown as Record<string, number>;
  return bucket[keyOf(key)] ?? 10;
}

function labelOf(key: string): string {
  const descriptor = ATTRIBUTE_DESCRIPTORS.find((entry) => `${entry.group}.${entry.key}` === key);
  return descriptor?.label ?? keyOf(key);
}

export function isHiddenAttribute(key: string): boolean {
  const descriptor = ATTRIBUTE_DESCRIPTORS.find((entry) => `${entry.group}.${entry.key}` === key);
  return descriptor ? !descriptor.visible : false;
}

/**
 * Age is the great limit. Physical attributes are effectively closed by thirty;
 * know-how keeps improving for longer. Goalkeepers and centre halves have the
 * longest runway, as they do in real life.
 */
function ageCeiling(player: Player, key: string): number {
  const group = groupOf(key);
  const key0 = keyOf(key);
  const isPhysical = group === 'physical';
  const isKeeper = player.preferredPosition === 'GK';
  if (isPhysical) {
    if (player.age <= 20) return 1;
    if (player.age <= 24) return 0.85;
    if (player.age <= 27) return 0.55;
    if (player.age <= 29) return 0.25;
    if (player.age <= 32) return 0.08;
    return 0.02;
  }
  if (group === 'mental' || group === 'hidden') {
    if (player.age <= 19) return 0.6;
    if (player.age <= 23) return 0.9;
    if (player.age <= 28) return 1;
    if (player.age <= 33) return 0.8;
    if (player.age <= 37) return 0.45;
    return 0.2;
  }
  if (group === 'behavioural') {
    if (key0 === 'reliability' || key0 === 'commitment') return player.age <= 30 ? 0.5 : 0.6;
    return 0.25;
  }
  // Technical: the keeper's work continues longest.
  if (isKeeper) return player.age <= 30 ? 0.85 : player.age <= 34 ? 0.5 : 0.2;
  if (player.age <= 20) return 1;
  if (player.age <= 24) return 0.85;
  if (player.age <= 28) return 0.55;
  if (player.age <= 31) return 0.3;
  if (player.age <= 34) return 0.15;
  return 0.05;
}

/** The per-attribute age weighting above, scaled by where he is in his career. */
function developmentCeiling(player: Player, key: string): number {
  return ageCeiling(player, key) * careerCeiling(player);
}

/**
 * Room left to improve: how far this man still is from what he is capable of.
 *
 * This is the difference between a player and a number. A 17 in something used
 * to be treated as "nearly finished" by every player in the world at once,
 * which quietly made the whole league's football ratchet upwards for ever. A
 * player now has his own ceiling, and once he is level with it he stops
 * improving however much he trains — so a squad's quality settles instead of
 * drifting.
 */
function headroom(player: Player): number {
  const current = overallAbility(player);
  const potential = profileFor(player).potential;
  if (!Number.isFinite(potential) || potential <= current) return 0;
  const remaining = (potential - current) / Math.max(1, potential - 8);
  return Math.max(0, Math.min(1.1, remaining));
}

/**
 * The career curve: how much a man can still take on at his age.
 *
 * Sits on top of the per-attribute age weighting above, so a player's *peak*
 * governs the shape of his curve while the attribute itself governs what closes
 * first. A goalkeeper's peak is later than a winger's, and his hands keep
 * working after his legs have stopped.
 */
function careerCeiling(player: Player): number {
  const peak = profileFor(player).peakAge;
  const age = player.age;
  if (age <= peak - 8) return 0.35;
  if (age <= peak - 3) return 0.85;
  if (age <= peak) return 1;
  if (age <= peak + 3) return 0.5;
  if (age <= peak + 7) return 0.18;
  return 0.04;
}

export interface DevelopmentContext {
  player: Player;
  blocks: readonly TrainingBlockId[];
  /** Minutes each block ran for. */
  minutesByBlock: Map<TrainingBlockId, number>;
  /** 0-1: how good the evening was, and how good the coaching was. */
  qualityFactor: number;
  date: string;
}

/**
 * Bank the work done in one session. Nothing visible happens here: this is the
 * slow accumulation that later turns into an improvement.
 */
export function accrueDevelopment(state: GameState, context: DevelopmentContext): void {
  const { player } = context;
  const opportunities = developmentFor(state, player.id);
  const determination = player.attributes.mental.determination / 20;
  const workRate = player.attributes.mental.workRate / 20;
  const consistency = player.attributes.hidden.consistency / 20;
  const rng = stream(state.seed, 'development', player.id, context.date, context.blocks.join(','));

  for (const blockId of context.blocks) {
    const minutes = context.minutesByBlock.get(blockId) ?? 0;
    if (minutes <= 0) continue;
    const block = BLOCK_DEVELOPMENT[blockId];
    if (!block || block.length === 0) continue;
    for (const key of block) {
      const ceiling = developmentCeiling(player, key);
      if (ceiling <= 0.02) continue;
      const room = headroom(player);
      if (room <= 0) continue;
      const personal = 0.65 + determination * 0.3 + workRate * 0.25 + consistency * 0.2;
      const gain =
        (minutes / 90) *
        0.2 *
        personal *
        (0.6 + context.qualityFactor * 0.7) *
        ceiling *
        room *
        rng.float(0.6, 1.4);
      opportunities[key] = (opportunities[key] ?? 0) + gain;
    }
  }
}

/**
 * Turn banked opportunity into real improvements. Called once per session: for
 * each attribute over the line, the player has to pass a gate that gets harder
 * with age, with how good he already is, and with how much he has already
 * improved recently.
 */
export function applyImprovements(
  state: GameState,
  player: Player,
  date: string,
  qualityFactor: number,
  moraleFactor: number,
): TrainingImprovement[] {
  const opportunities = developmentFor(state, player.id);
  const improvements: TrainingImprovement[] = [];
  const adaptability = player.attributes.hidden.adaptability / 20;
  const consistency = player.attributes.hidden.consistency / 20;
  const rng = stream(state.seed, 'improvement', player.id, date);

  for (const [key, banked] of Object.entries(opportunities)) {
    if (banked < THRESHOLD) continue;
    const value = attributeValueOf(player, key);
    if (value >= MAX_ATTRIBUTE) {
      opportunities[key] = 0;
      continue;
    }
    const chance =
      0.3 *
      developmentCeiling(player, key) *
      headroom(player) *
      (0.7 + adaptability * 0.4 + consistency * 0.2) *
      (0.7 + moraleFactor * 0.4) *
      (0.75 + qualityFactor * 0.5);
    if (rng.chance(Math.max(0, Math.min(0.85, chance)))) {
      (player.attributes[groupOf(key)] as unknown as Record<string, number>)[keyOf(key)] = clampAttribute(value + 1);
      improvements.push({ personId: player.id, attribute: key, label: labelOf(key) });
      // The work that went in is spent; a little carries over as momentum.
      opportunities[key] = Math.max(0, banked - THRESHOLD) * 0.25;
      player.notes.push(`Improved his ${labelOf(key).toLowerCase()} over the season.`);
      if (player.notes.length > 12) player.notes.splice(0, player.notes.length - 12);
    } else {
      // He worked at it and it did not stick — the usual outcome.
      opportunities[key] = banked - THRESHOLD * 0.35;
    }
  }

  return improvements;
}

/**
 * What a man has left, in plain words.
 *
 * The numbers behind this are a ceiling and a peak age; the manager is told a
 * sentence. It is deliberately vague in the way a Sunday League manager is
 * deliberately vague — nobody at this level has ever watched a training
 * spreadsheet.
 */
export function developmentOutlook(player: Player): string {
  const peak = profileFor(player).peakAge;
  const room = headroom(player);
  if (player.age >= peak + 5) return 'Well past his best. He is on the way down.';
  if (player.age > peak) return 'Around his peak years, and holding what he has.';
  if (room <= 0.05) return 'Made as good as he is going to get.';
  if (room > 0.5) return 'Raw, and with a lot still to come.';
  return 'Getting better, slowly.';
}

/**
 * Take a point off a man who is past his peak.
 *
 * The other half of the curve, and the reason the world's football stops
 * improving. A player loses his legs long before he loses his know-how, so
 * physical attributes go first and hardest, and the decline accelerates the
 * further past his peak he is. Training does nothing about it — there is no
 * session that gives a man his twenties back.
 */
export function applyDecline(state: GameState, player: Player, date: string): TrainingDecline[] {
  const peak = profileFor(player).peakAge;
  // Nothing goes until a couple of years past the peak: a man at his best is
  // still at his best.
  const yearsPast = player.age - (peak + 2);
  if (yearsPast <= 0) return [];

  const declines: TrainingDecline[] = [];
  const rng = stream(state.seed, 'decline', player.id, date);
  const perSession = DECLINE_PER_SEASON / (SESSIONS_PER_SEASON * Math.max(1, TOTAL_DECLINE_WEIGHT));

  for (const descriptor of ATTRIBUTE_DESCRIPTORS) {
    const value = attributeValueOf(player, `${descriptor.group}.${descriptor.key}`);
    if (value <= 1) continue;
    const weight = DECLINE_WEIGHT[descriptor.group] ?? 0.5;
    const chance = perSession * weight * yearsPast * rng.float(0.6, 1.4);
    if (!rng.chance(chance)) continue;
    (player.attributes[descriptor.group] as unknown as Record<string, number>)[descriptor.key] =
      clampAttribute(value - 1);
    declines.push({ personId: player.id, attribute: `${descriptor.group}.${descriptor.key}`, label: descriptor.label });
  }

  return declines;
}

/** How close a player is to improving something, for the manager's own notes. */
export function developmentSummary(state: GameState, player: Player): string[] {
  const opportunities = developmentFor(state, player.id);
  return Object.entries(opportunities)
    .filter(([, value]) => value >= THRESHOLD * 0.8)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => `Coming on with his ${labelOf(key).toLowerCase()}`);
}

const BLOCK_DEVELOPMENT: Record<TrainingBlockId, string[]> = {
  'warm-up': [],
  possession: ['technical.passing', 'technical.ballControl', 'mental.decisions', 'hidden.tacticalIntelligence'],
  attacking: ['technical.shooting', 'technical.passing', 'mental.positioning', 'mental.composure'],
  defending: ['technical.tackling', 'mental.positioning', 'mental.decisions', 'physical.strength'],
  fitness: ['physical.stamina', 'physical.strength', 'physical.pace'],
  tactical: ['hidden.tacticalIntelligence', 'mental.positioning', 'mental.decisions'],
  'set-pieces': ['technical.crossing', 'technical.heading', 'technical.shooting', 'technical.passing'],
  teamwork: ['mental.workRate', 'mental.determination', 'behavioural.commitment', 'hidden.tacticalIntelligence'],
};
