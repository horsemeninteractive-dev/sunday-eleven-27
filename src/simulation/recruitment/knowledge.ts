import { readAttribute, type PlayerAttributes } from '@/domain/attributes';
import type { ISODate, PersonId } from '@/domain/ids';
import { isPlayer, type Player } from '@/domain/person';
import {
  RELATIONSHIP_ORIGIN_LABEL,
  attitudeOf,
  attitudeToward,
  relationshipStrength,
} from '@/domain/relationship';
import {
  assessableAttributeKeys,
  bandForValue,
  emptyKnowledge,
  shiftBand,
  type AttributeKey,
  type AttributeKnowledge,
  type CandidateKnowledge,
  type KnowledgeConfidence,
  type RecommendationSentiment,
} from '@/domain/recruitment';
import type { GameState } from '@/domain/game';
import { getRelationship } from '../relationships';
import { Rng } from '../rng';

/**
 * How the manager comes to believe things about a player.
 *
 * Every read carries a source and a confidence. A recommendation from a
 * teammate you trust produces a handful of "reported" bands that are usually
 * about right; a recommendation from somebody who hardly knows the lad, or who
 * cannot stand him, produces fewer bands and more of them are wrong. Watching
 * somebody yourself produces "known" bands. Hidden characteristics are never
 * banded at all — they surface as prose impressions that may or may not be
 * right.
 */

const CONFIDENCE_RANK: Record<KnowledgeConfidence, number> = { hunch: 0, reported: 1, known: 2 };

export interface KnowledgeSource {
  /** "Kev Taylor says", "You watched him", "A session at The Rec". */
  label: string;
  confidence: KnowledgeConfidence;
}

export interface ReadOptions {
  rng: Rng;
  player: Player;
  source: KnowledgeSource;
  date: ISODate;
  /** Fraction of the assessable attributes this read covers, 0-1. */
  coverage: number;
  /** Chance any single band is accurate, 0-1. */
  accuracy: number;
  /** Positive biases over-rate him ("he's brilliant, honestly"). */
  bias?: number;
}

function trueBand(player: Player, key: AttributeKey): ReturnType<typeof bandForValue> {
  const [group, attr] = key.split('.');
  if (!group || !attr) return 'Decent';
  return bandForValue(readAttribute(player.attributes, group as keyof PlayerAttributes, attr));
}

/** Read a subset of a player's attributes into confidence-tagged bands. */
export function readAttributes(options: ReadOptions): Record<AttributeKey, AttributeKnowledge> {
  const { rng, player, source, date } = options;
  const keys = rng.shuffle(assessableAttributeKeys(player.preferredPosition === 'GK'));
  const count = Math.max(1, Math.round(keys.length * Math.max(0.05, Math.min(1, options.coverage))));
  const chosen = keys.slice(0, count);
  const bias = options.bias ?? 0;
  const result: Record<AttributeKey, AttributeKnowledge> = {};

  for (const key of chosen) {
    const band = trueBand(player, key);
    let observed = band;
    if (rng.next() > options.accuracy) {
      // Wrong reads go the way the source leans: a mate talks him up, somebody
      // with a grudge runs him down.
      const direction = bias > 0 ? 1 : bias < 0 ? -1 : rng.chance(0.5) ? 1 : -1;
      observed = shiftBand(band, direction * rng.int(1, Math.abs(bias) > 0.5 ? 2 : 1));
    }
    result[key] = { band: observed, confidence: source.confidence, source: source.label, date };
  }
  return result;
}

/** Merge a new read into what the manager already believed. */
export function mergeKnowledge(
  existing: CandidateKnowledge,
  updates: Record<AttributeKey, AttributeKnowledge>,
  notes: string[] = [],
): CandidateKnowledge {
  const merged: CandidateKnowledge = {
    attributes: { ...existing.attributes },
    notes: [...existing.notes],
  };

  for (const [key, entry] of Object.entries(updates)) {
    const current = merged.attributes[key];
    // Fresher and at least as solid wins; a hunch never overwrites a fact.
    if (!current || CONFIDENCE_RANK[entry.confidence] >= CONFIDENCE_RANK[current.confidence]) {
      merged.attributes[key] = entry;
    }
  }

  for (const note of notes) {
    if (!note) continue;
    if (merged.notes.includes(note)) continue;
    merged.notes.push(note);
  }
  if (merged.notes.length > 14) merged.notes.length = 14;

  return merged;
}

/** Character reads. These describe hidden and behavioural traits in words. */
export function characterNotes(rng: Rng, player: Player, limit = 3): string[] {
  const candidates: string[] = [];
  const hidden = player.attributes.hidden;
  const behavioural = player.attributes.behavioural;
  const physical = player.attributes.physical;
  const technical = player.attributes.technical;
  const mental = player.attributes.mental;

  if (hidden.consistency <= 8) candidates.push('Goes missing for spells in games.');
  if (hidden.temperament <= 8) candidates.push('Mouths off when decisions go against him.');
  if (hidden.pressureResponse <= 8) candidates.push('Tightens up when it matters.');
  if (hidden.injurySusceptibility >= 14) candidates.push('Always seems to be carrying a knock.');
  if (hidden.adaptability <= 8) candidates.push('Does not adapt when the shape changes.');
  if (hidden.tacticalIntelligence >= 15) candidates.push('Reads the game well for this level.');
  if (behavioural.commitment <= 8) candidates.push('Looks like he needs chasing to turn up.');
  if (behavioural.reliability <= 8) candidates.push('A job to pin down at short notice.');
  if (behavioural.discipline <= 8) candidates.push('Prone to a silly booking.');
  if (behavioural.ambition >= 15) candidates.push('Might reckon he is better than this level.');
  if (behavioural.loyalty >= 15) candidates.push('Sounds settled wherever he plays.');
  if (physical.stamina <= 8) candidates.push('Blows up after an hour.');
  if (physical.pace >= 15) candidates.push('Quick — seriously quick.');
  if (physical.strength >= 15) candidates.push('Strong as an ox.');
  if (technical.heading >= 14) candidates.push('Good in the air.');
  if (technical.shooting >= 14) candidates.push('Strikes it cleanly.');
  if (mental.workRate >= 15) candidates.push('Works his socks off.');
  if (mental.determination >= 15) candidates.push('Does not let his head drop.');
  if (mental.composure >= 14) candidates.push('Composed on the ball.');

  if (candidates.length === 0) return [];
  return rng.shuffle(candidates).slice(0, limit);
}

function meanAssessable(player: Player): number {
  const keys = assessableAttributeKeys(player.preferredPosition === 'GK');
  const total = keys.reduce((sum, key) => {
    const [group, attr] = key.split('.');
    if (!group || !attr) return sum;
    return sum + readAttribute(player.attributes, group as keyof PlayerAttributes, attr);
  }, 0);
  return total / Math.max(1, keys.length);
}

/** How good a player is, in bands, on the manager's own scale. */
export function abilityBandOf(player: Player): ReturnType<typeof bandForValue> {
  return bandForValue(meanAssessable(player));
}

export function meanAttributeOf(player: Player): number {
  return meanAssessable(player);
}

/** 0-1 credibility of a teammate's word, from the graph and the man himself. */
export function recommendationCredibility(
  state: GameState,
  recommenderId: PersonId,
  candidateId: PersonId,
): { credibility: number; closeness: number; trust: number; reliability: number; origin: string | null } {
  const recommender = state.people[recommenderId];
  const relationship = getRelationship(state, recommenderId, candidateId);
  const withManager = state.clubs[state.userClubId]?.managerId
    ? getRelationship(state, recommenderId, state.clubs[state.userClubId]!.managerId!)
    : undefined;

  const closeness = relationship ? relationship.strength / 100 : 0.1;
  const trust = withManager
    ? (attitudeToward(withManager, recommenderId)!.trust + attitudeOf(withManager, recommenderId)!.friendship) / 200
    : 0.4;
  const reliability = isPlayer(recommender)
    ? (recommender.attributes.behavioural.reliability + recommender.attributes.hidden.consistency) / 40
    : 0.5;

  const credibility = Math.max(
    0.08,
    Math.min(0.95, closeness * 0.42 + trust * 0.3 + reliability * 0.28),
  );
  return {
    credibility,
    closeness,
    trust,
    reliability,
    origin: relationship ? RELATIONSHIP_ORIGIN_LABEL[relationship.origin] : null,
  };
}

export interface RecommendationRead {
  knowledge: CandidateKnowledge;
  sentiment: RecommendationSentiment;
  note: string;
  credibility: number;
}

export function knowledgeFromRecommendation(
  state: GameState,
  rng: Rng,
  options: { candidate: Player; recommender: Player; date: ISODate },
): RecommendationRead {
  const { candidate, recommender, date } = options;
  const { credibility, closeness, origin } = recommendationCredibility(state, recommender.id, candidate.id);
  const relationship = getRelationship(state, recommender.id, candidate.id);
  const recommenderAttitude = relationship ? attitudeOf(relationship, recommender.id) : null;

  const grudge = Boolean(
    relationship &&
      relationshipStrength(relationship.aToB, relationship.bToA) < 40 &&
      (recommenderAttitude!.tension >= 45 || recommenderAttitude!.friendship <= 32),
  );
  const sentiment: RecommendationSentiment = grudge ? 'warning' : closeness >= 0.55 ? 'backed' : 'neutral';

  const coverage = Math.max(0.2, Math.min(0.7, 0.28 + credibility * 0.42));
  const accuracy = Math.max(0.2, Math.min(0.85, 0.18 + credibility * 0.6));
  const bias = sentiment === 'backed' ? 0.9 : sentiment === 'warning' ? -1 : 0;

  const knowledge = mergeKnowledge(
    emptyKnowledge(),
    readAttributes({
      rng,
      player: candidate,
      source: { label: `${recommender.firstName} ${recommender.surname} says`, confidence: 'reported' },
      date,
      coverage,
      accuracy,
      bias,
    }),
  );

  const name = `${recommender.firstName} ${recommender.surname}`;
  const position = candidate.preferredPosition;
  const note =
    sentiment === 'warning'
      ? `${name} says don't bother with him: “${rng.pick([
          'he is always injured',
          'he never turns up',
          'he would not last five minutes with you',
          'he is more trouble than he is worth',
        ])}.”`
      : sentiment === 'backed'
        ? `${name} reckons he could do a job at ${position}: “${rng.pick([
            'best player I have played with at this level',
            'he would walk into most teams around here',
            'he is exactly what you are short of',
          ])}.”`
        : `${name} mentioned a ${position} he knows who is after a game.`;

  const notes =
    origin && sentiment !== 'warning'
      ? [`${name} knows him through local football (${origin.toLowerCase()}).`]
      : [];

  return {
    knowledge: mergeKnowledge(knowledge, {}, notes),
    sentiment,
    note,
    credibility,
  };
}

export interface ObservationRead {
  knowledge: CandidateKnowledge;
  notes: string[];
  /** One-line summary of what the manager made of it. */
  summary: string;
}

export function knowledgeFromObservation(
  rng: Rng,
  options: { candidate: Player; date: ISODate; context: string },
): ObservationRead {
  const { candidate, date, context } = options;
  const knowledge = mergeKnowledge(
    emptyKnowledge(),
    readAttributes({
      rng,
      player: candidate,
      source: { label: 'You watched him', confidence: 'known' },
      date,
      coverage: 0.5,
      accuracy: 0.75,
    }),
  );
  const notes = characterNotes(rng, candidate, 2);
  return {
    knowledge: { attributes: knowledge.attributes, notes },
    notes,
    summary: `${context}. You saw enough to form a view of him.`,
  };
}

export interface TrialRead {
  knowledge: CandidateKnowledge;
  notes: string[];
  impression: 'impressed' | 'mixed' | 'poor';
  summary: string;
}

/**
 * What a training session tells you. A trial is a real look at a player, but it
 * is one evening on a Thursday with half the squad missing — plenty of players
 * look better or worse than they are.
 */
export function knowledgeFromTrial(
  rng: Rng,
  options: { candidate: Player; date: ISODate; clubQuality: number; sessionLabel?: string },
): TrialRead {
  const { candidate, date, clubQuality } = options;
  const label = options.sessionLabel ?? 'A session with the squad';

  const knowledge = mergeKnowledge(
    emptyKnowledge(),
    readAttributes({
      rng,
      player: candidate,
      source: { label, confidence: 'known' },
      date,
      coverage: 0.62,
      accuracy: 0.8,
    }),
  );

  const notes = characterNotes(rng, candidate, 2);
  if (candidate.fitness < 72) notes.push('Looked a yard off the pace fitness-wise.');
  if (candidate.attributes.physical.stamina <= 8) notes.push('Flagged badly in the last twenty minutes.');
  if (
    candidate.preferredPosition === 'GK' &&
    candidate.attributes.technical.goalkeeping >= clubQuality + 1
  ) {
    notes.push('Some of the saves he made were outrageous for this level.');
  }
  if (candidate.age >= 34) notes.push('Sensible head on him — talks the young lads through it.');

  const ability = meanAttributeOf(candidate);
  const gap = ability - clubQuality;
  const roll = rng.gaussian(0, 1.4);
  const impression: TrialRead['impression'] =
    gap + roll > 1 ? 'impressed' : gap + roll < -1.2 ? 'poor' : 'mixed';

  const summary =
    impression === 'impressed'
      ? `${candidate.firstName} was the best player on the pitch at training.`
      : impression === 'poor'
        ? `${candidate.firstName} looked out of his depth.`
        : `${candidate.firstName} did alright without setting the world alight.`;

  return { knowledge: { attributes: knowledge.attributes, notes }, notes, impression, summary };
}

/** Convenience: knowledge summary counts for the UI and tests. */
export function knowledgeCounts(knowledge: CandidateKnowledge): {
  known: number;
  reported: number;
  hunch: number;
  total: number;
} {
  const values = Object.values(knowledge.attributes);
  return {
    known: values.filter((entry) => entry.confidence === 'known').length,
    reported: values.filter((entry) => entry.confidence === 'reported').length,
    hunch: values.filter((entry) => entry.confidence === 'hunch').length,
    total: values.length,
  };
}

/** Read a single attribute's band directly, for tests and tools. */
export function bandOf(player: Player, key: AttributeKey): ReturnType<typeof bandForValue> {
  return trueBand(player, key);
}
