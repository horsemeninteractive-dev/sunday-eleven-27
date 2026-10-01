import { ATTRIBUTE_DESCRIPTORS } from './attributes';
import type { ISODate, PersonId } from './ids';
import type { PositionGroup } from './positions';

/**
 * Recruitment is a social discovery process, not a database lookup.
 *
 * A `RecruitmentCandidate` is not a player record — it is *what the manager
 * currently believes about somebody*. Every fact in it carries where it came
 * from and how much it can be trusted, so "Kev says he's a good finisher" and
 * "you watched him yourself" are different kinds of information, and neither
 * of them is an attribute number.
 */

/** How much weight a piece of information carries. */
export type KnowledgeConfidence =
  /** Seen for yourself, or established beyond doubt (a trial, your own eyes). */
  | 'known'
  /** Second hand: a recommendation, another manager's opinion, club gossip. */
  | 'reported'
  /** A feeling rather than a fact. Usually wrong as often as it is right. */
  | 'hunch';

export const KNOWLEDGE_CONFIDENCE_LABEL: Record<KnowledgeConfidence, string> = {
  known: 'Known',
  reported: 'Reported',
  hunch: 'Suspected',
};

/** Coarse bands. The manager never sees a 1-20 number for somebody he just met. */
export type ObservationBand = 'Poor' | 'Limited' | 'Decent' | 'Good' | 'Strong' | 'Outstanding';

export const OBSERVATION_BANDS: ObservationBand[] = ['Poor', 'Limited', 'Decent', 'Good', 'Strong', 'Outstanding'];

/** Attribute keys are flat, e.g. `technical.shooting`. */
export type AttributeKey = string;

export function attributeLabel(key: AttributeKey): string {
  const descriptor = ATTRIBUTE_DESCRIPTORS.find(
    (entry) => `${entry.group}.${entry.key}` === key || entry.key === key,
  );
  return descriptor?.label ?? key;
}

export function attributeKey(group: string, key: string): AttributeKey {
  return `${group}.${key}`;
}

/** Which bands a 1-20 value falls into. 10-11 is the Sunday League average. */
export function bandForValue(value: number): ObservationBand {
  if (value <= 4) return 'Poor';
  if (value <= 7) return 'Limited';
  if (value <= 10) return 'Decent';
  if (value <= 13) return 'Good';
  if (value <= 16) return 'Strong';
  return 'Outstanding';
}

export function bandIndex(band: ObservationBand): number {
  return OBSERVATION_BANDS.indexOf(band);
}

export function shiftBand(band: ObservationBand, offset: number): ObservationBand {
  const index = bandIndex(band) + offset;
  if (index < 0) return OBSERVATION_BANDS[0]!;
  if (index >= OBSERVATION_BANDS.length) return OBSERVATION_BANDS[OBSERVATION_BANDS.length - 1]!;
  return OBSERVATION_BANDS[index]!;
}

export interface AttributeKnowledge {
  band: ObservationBand;
  confidence: KnowledgeConfidence;
  /** Who or what the belief came from, in words: "Kev Taylor says", "You watched him". */
  source: string;
  date: ISODate;
}

export interface CandidateKnowledge {
  /** Only the attributes the manager has actually formed a view on. */
  attributes: Record<AttributeKey, AttributeKnowledge>;
  /** Prose impressions: character reads, fitness worries, positional notes. */
  notes: string[];
}

export function emptyKnowledge(): CandidateKnowledge {
  return { attributes: {}, notes: [] };
}

/** How the manager came to hear about somebody. */
export type DiscoverySource =
  | 'recommendation'
  | 'five-a-side'
  | 'open-session'
  | 'approach'
  | 'contact';

export const DISCOVERY_SOURCE_LABEL: Record<DiscoverySource, string> = {
  recommendation: 'Recommended by a player',
  'five-a-side': 'Spotted at five-a-side',
  'open-session': 'Turned up to an open session',
  approach: 'Approached the club',
  contact: 'Through a local contact',
};

/** Whether the person who put the name forward was encouraging or warning. */
export type RecommendationSentiment = 'backed' | 'warning' | 'neutral';

export type CandidateStatus =
  /** On the list, nothing more. */
  | 'watching'
  /** Asked to come down to a session. */
  | 'invited'
  /** Has been down to at least one session. */
  | 'trialled'
  /** The club has asked him whether he fancies it. */
  | 'approached'
  /** Signed and registered. */
  | 'joined'
  /** Turned the club down. */
  | 'declined'
  /** The club decided against it. */
  | 'passed';

export const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, string> = {
  watching: 'On the list',
  invited: 'Invited to a session',
  trialled: 'Been down to training',
  approached: 'Asked him about it',
  joined: 'Signed',
  declined: 'Turned us down',
  passed: 'Not for us',
};

export interface RecruitmentHistoryEntry {
  date: ISODate;
  seasonLabel: string;
  description: string;
}

export interface RecruitmentCandidate {
  personId: PersonId;
  discoveredOn: ISODate;
  discoveredVia: DiscoverySource;
  /** Who put the name forward, where there was somebody. */
  sourcePersonId: PersonId | null;
  /** How it was put to the manager: "Kev reckons he could do a job at centre-half." */
  sourceNote: string;
  sentiment: RecommendationSentiment;
  status: CandidateStatus;
  knowledge: CandidateKnowledge;
  history: RecruitmentHistoryEntry[];
  /** Sessions attended. */
  trials: number;
  /** Observations the manager has picked up about whether he would actually come. */
  interestHints: string[];
  /** Set when the player gave a reason for turning the club down. */
  outcome: string | null;
  lastReviewedOn: ISODate | null;
}

export interface RecruitmentStore {
  candidates: Record<PersonId, RecruitmentCandidate>;
  /** Invited to the next session. */
  pendingTrialIds: PersonId[];
  /** Matchday on which the manager last got out to watch somebody. */
  lastWatchedOn: ISODate | null;
  /** Matchday on which the squad was last asked for names. */
  lastAskedOn: ISODate | null;
  /** Matchday on which an open session was last put on. */
  lastOpenSessionOn: ISODate | null;
  /** Matchday on which the manager last looked in at five-a-side. */
  lastFiveASideOn: ISODate | null;
  /** Set once the chairman has had his say about the squad's numbers. */
  lastNudgeOn: ISODate | null;
}

export function emptyRecruitmentStore(): RecruitmentStore {
  return {
    candidates: {},
    pendingTrialIds: [],
    lastWatchedOn: null,
    lastAskedOn: null,
    lastOpenSessionOn: null,
    lastFiveASideOn: null,
    lastNudgeOn: null,
  };
}

export interface KnowledgeLine {
  key: AttributeKey;
  label: string;
  band: ObservationBand;
  confidence: KnowledgeConfidence;
  source: string;
  date: ISODate;
}

/** Everything the manager believes about a candidate, as lines he can read. */
export function knowledgeLines(knowledge: CandidateKnowledge): KnowledgeLine[] {
  return Object.entries(knowledge.attributes)
    .map(([key, entry]) => ({
      key,
      label: attributeLabel(key),
      band: entry.band,
      confidence: entry.confidence,
      source: entry.source,
      date: entry.date,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The visible attributes a candidate can ever be assessed on. */
export function assessableAttributeKeys(isGoalkeeper: boolean): AttributeKey[] {
  return ATTRIBUTE_DESCRIPTORS.filter((descriptor) => {
    if (!descriptor.visible) return false;
    if (descriptor.group === 'behavioural') return false;
    if (descriptor.key === 'goalkeeping' && !isGoalkeeper) return false;
    return true;
  }).map((descriptor) => attributeKey(descriptor.group, descriptor.key));
}

/** Character and reliability are impressions, not stats, so they are read in prose. */
export const BEHAVIOURAL_KEYS: AttributeKey[] = ATTRIBUTE_DESCRIPTORS.filter(
  (descriptor) => descriptor.group === 'behavioural',
).map((descriptor) => attributeKey(descriptor.group, descriptor.key));

export interface SquadNeed {
  group: PositionGroup;
  label: string;
  registered: number;
  available: number;
  reliable: number;
  averageAge: number;
  verdict: 'thin' | 'ok' | 'strong';
  note: string;
}

export interface SquadNeeds {
  positions: SquadNeed[];
  /** Positions the manager is genuinely short of. */
  thinGroups: PositionGroup[];
  /** Lines to show at the top of the recruitment screen. */
  summary: string[];
  /** Registered player count per position code, e.g. { CB: 3 }. */
  byPosition: Record<string, number>;
}
