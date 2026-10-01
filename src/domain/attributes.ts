/**
 * Player attributes use the design document's underlying 1-20 scale.
 *
 * The scale is deliberately coarse: a 12 is a competent Sunday League player,
 * 15+ is exceptional for the level, 8 or below is a weak link.
 *
 * `hidden` attributes are never shown directly in the UI — they colour
 * simulation outcomes (streakiness, injuries, pressure) and are surfaced only
 * as impressions/opinions.
 */
export type AttributeValue = number; // 1..20

export interface TechnicalAttributes {
  passing: AttributeValue;
  shooting: AttributeValue;
  tackling: AttributeValue;
  ballControl: AttributeValue;
  crossing: AttributeValue;
  heading: AttributeValue;
  /** Goalkeeping ability. Only meaningful for keepers; outfielders sit near 1-4. */
  goalkeeping: AttributeValue;
}

export interface PhysicalAttributes {
  pace: AttributeValue;
  stamina: AttributeValue;
  strength: AttributeValue;
  agility: AttributeValue;
}

export interface MentalAttributes {
  positioning: AttributeValue;
  decisions: AttributeValue;
  composure: AttributeValue;
  workRate: AttributeValue;
  determination: AttributeValue;
}

export interface BehaviouralAttributes {
  commitment: AttributeValue;
  discipline: AttributeValue;
  ambition: AttributeValue;
  loyalty: AttributeValue;
  /** How likely a player is to turn up as promised. Drives the availability system. */
  reliability: AttributeValue;
}

export interface HiddenAttributes {
  consistency: AttributeValue;
  adaptability: AttributeValue;
  pressureResponse: AttributeValue;
  tacticalIntelligence: AttributeValue;
  injurySusceptibility: AttributeValue;
  temperament: AttributeValue;
}

export interface PlayerAttributes {
  technical: TechnicalAttributes;
  physical: PhysicalAttributes;
  mental: MentalAttributes;
  behavioural: BehaviouralAttributes;
  hidden: HiddenAttributes;
}

export type AttributeGroup = keyof PlayerAttributes;

export interface AttributeDescriptor {
  group: AttributeGroup;
  key: string;
  label: string;
  /** Whether this attribute may be shown directly in the UI. */
  visible: boolean;
}

export const ATTRIBUTE_DESCRIPTORS: AttributeDescriptor[] = [
  { group: 'technical', key: 'passing', label: 'Passing', visible: true },
  { group: 'technical', key: 'shooting', label: 'Shooting', visible: true },
  { group: 'technical', key: 'tackling', label: 'Tackling', visible: true },
  { group: 'technical', key: 'ballControl', label: 'Control', visible: true },
  { group: 'technical', key: 'crossing', label: 'Crossing', visible: true },
  { group: 'technical', key: 'heading', label: 'Heading', visible: true },
  { group: 'technical', key: 'goalkeeping', label: 'Keeping', visible: true },
  { group: 'physical', key: 'pace', label: 'Pace', visible: true },
  { group: 'physical', key: 'stamina', label: 'Stamina', visible: true },
  { group: 'physical', key: 'strength', label: 'Strength', visible: true },
  { group: 'physical', key: 'agility', label: 'Agility', visible: true },
  { group: 'mental', key: 'positioning', label: 'Positioning', visible: true },
  { group: 'mental', key: 'decisions', label: 'Decisions', visible: true },
  { group: 'mental', key: 'composure', label: 'Composure', visible: true },
  { group: 'mental', key: 'workRate', label: 'Work rate', visible: true },
  { group: 'mental', key: 'determination', label: 'Determination', visible: true },
  { group: 'behavioural', key: 'commitment', label: 'Commitment', visible: true },
  { group: 'behavioural', key: 'discipline', label: 'Discipline', visible: true },
  { group: 'behavioural', key: 'ambition', label: 'Ambition', visible: true },
  { group: 'behavioural', key: 'loyalty', label: 'Loyalty', visible: true },
  { group: 'behavioural', key: 'reliability', label: 'Reliability', visible: true },
  { group: 'hidden', key: 'consistency', label: 'Consistency', visible: false },
  { group: 'hidden', key: 'adaptability', label: 'Adaptability', visible: false },
  { group: 'hidden', key: 'pressureResponse', label: 'Pressure response', visible: false },
  { group: 'hidden', key: 'tacticalIntelligence', label: 'Tactical intelligence', visible: false },
  { group: 'hidden', key: 'injurySusceptibility', label: 'Injury susceptibility', visible: false },
  { group: 'hidden', key: 'temperament', label: 'Temperament', visible: false },
];

export function readAttribute(
  attributes: PlayerAttributes,
  group: AttributeGroup,
  key: string,
): AttributeValue {
  const bucket = attributes[group] as unknown as Record<string, AttributeValue>;
  return bucket[key] ?? 1;
}

export const MAX_ATTRIBUTE = 20;
export const MIN_ATTRIBUTE = 1;

export function clampAttribute(value: number): AttributeValue {
  return Math.max(MIN_ATTRIBUTE, Math.min(MAX_ATTRIBUTE, Math.round(value)));
}
