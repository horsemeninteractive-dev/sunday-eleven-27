import type { GameState } from '@/domain/game';
import { ATTRIBUTE_DESCRIPTORS, MAX_ATTRIBUTE, clampAttribute, type AttributeGroup } from '@/domain/attributes';
import type { Player } from '@/domain/person';
import type { TrainingBlockId, TrainingImprovement } from '@/domain/training';
import { stream } from '../rng';
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

/** Opportunity needed before an improvement is even considered. */
const THRESHOLD = 1;

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

/** Room left to improve: a 17 in something is nearly finished. */
function headroom(value: number): number {
  const remaining = (MAX_ATTRIBUTE - value) / (MAX_ATTRIBUTE - 8);
  return Math.max(0.03, Math.min(1.1, remaining));
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
      const value = attributeValueOf(player, key);
      const ceiling = ageCeiling(player, key);
      if (ceiling <= 0.02) continue;
      const personal = 0.65 + determination * 0.3 + workRate * 0.25 + consistency * 0.2;
      const gain =
        (minutes / 90) *
        0.2 *
        personal *
        (0.6 + context.qualityFactor * 0.7) *
        ceiling *
        headroom(value) *
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
      ageCeiling(player, key) *
      headroom(value) *
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
