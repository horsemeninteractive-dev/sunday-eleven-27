import type { PlayerAttributes } from './attributes';
import type { ClubId, ClubRole, GroundId, ISODate, PersonId, PlayerId, TownId } from './ids';
import type { PositionCode, PositionGroup } from './positions';

export type PersonKind = 'player' | 'official';

export type Personality =
  | 'Quiet'
  | 'Laid back'
  | 'Confident'
  | 'Talkative'
  | 'Competitive'
  | 'Wind-up merchant'
  | 'Model pro'
  | 'Hot-headed'
  | 'Joker'
  | 'Reliable sort';

export interface PersonBase {
  id: PersonId;
  kind: PersonKind;
  firstName: string;
  surname: string;
  /** Common local nickname, e.g. "Taff", "Big Dave". Optional flavour. */
  nickname?: string;
  age: number;
  townId: TownId | null;
  occupation: string;
  /** 1-100 standing in the local football community. */
  reputation: number;
  /** Roles held at clubs. A person can hold more than one (player-manager). */
  roles: Array<{ clubId: ClubId; role: ClubRole; since: ISODate }>;
}

export type AvailabilityStatus = 'available' | 'doubtful' | 'unavailable';

export type AvailabilityReason =
  | 'work'
  | 'holiday'
  | 'family'
  | 'injury'
  | 'illness'
  | 'other-football'
  | 'unexplained'
  | 'suspension'
  | 'personal';

export const AVAILABILITY_REASON_LABEL: Record<AvailabilityReason, string> = {
  work: 'Working',
  holiday: 'On holiday',
  family: 'Family commitment',
  injury: 'Injured',
  illness: 'Ill',
  'other-football': 'Playing Saturday football',
  unexplained: 'Not responding',
  suspension: 'Suspended',
  personal: 'Personal reasons',
};

/**
 * Availability is re-rolled every football week from the player's life,
 * personality and circumstances. It is deliberately *not* permanent club
 * property: being registered does not mean being available.
 */
export interface AvailabilityState {
  status: AvailabilityStatus;
  reason: AvailabilityReason | null;
  /** Short human-readable note used in the squad list. */
  note: string | null;
  /** Date the player is expected back, if known. */
  until: ISODate | null;
  /** True when the club only finds out late (a classic Sunday League problem). */
  discoveredLate: boolean;
}

export interface InjuryState {
  description: string;
  severity: 'knock' | 'minor' | 'moderate' | 'serious';
  /** Days until the player is fit to be considered again. */
  daysOut: number;
  occurredOn: ISODate;
}

/**
 * How well a player knows the way his club plays: the shape, the instructions
 * and the set-piece routines. Kept on the 1-20 scale used by attributes, but
 * it is *not* ability: it is what he has learned at this club, and it goes with
 * the club (a new signing does not know it; a change of formation unravels
 * some of it). Positional knowledge is already tracked separately in
 * `positionalFamiliarity`.
 */
export interface SystemFamiliarity {
  formation: number;
  instructions: number;
  setPieces: number;
}

export const MAX_SYSTEM_FAMILIARITY = 20;

export function clampSystemFamiliarity(value: number): number {
  return Math.max(0, Math.min(MAX_SYSTEM_FAMILIARITY, Math.round(value * 10) / 10));
}

export function createSystemFamiliarity(partial: Partial<SystemFamiliarity> = {}): SystemFamiliarity {
  return {
    formation: clampSystemFamiliarity(partial.formation ?? 10),
    instructions: clampSystemFamiliarity(partial.instructions ?? 10),
    setPieces: clampSystemFamiliarity(partial.setPieces ?? 10),
  };
}

export function meanSystemFamiliarity(familiarity: SystemFamiliarity | undefined): number {
  if (!familiarity) return 10;
  return (familiarity.formation + familiarity.instructions + familiarity.setPieces) / 3;
}

export interface PlayerHistoryEntry {
  seasonLabel: string;
  clubId: ClubId | null;
  appearances: number;
  substituteAppearances: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
}

export interface PlayerRecord {
  appearances: number;
  substituteAppearances: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  seasons: PlayerHistoryEntry[];
}

export interface Player extends PersonBase {
  kind: 'player';
  clubId: ClubId | null;
  /** Registered with the league for the current season. */
  registered: boolean;
  heightCm: number;
  preferredPosition: PositionCode;
  positionGroup: PositionGroup;
  /** 1-20 familiarity per position (20 = only position they really play). */
  positionalFamiliarity: Partial<Record<PositionCode, number>>;
  /** How well he knows this club's shape, instructions and set pieces (0-20). */
  systemFamiliarity: SystemFamiliarity;
  attributes: PlayerAttributes;
  personality: Personality;
  /** 0-100 match sharpness/freshness. Drops with minutes, recovers weekly. */
  fitness: number;
  /** 0-100, 50 = neutral. Moves with performances and morale. */
  form: number;
  /** 0-100 dressing-room/social state. */
  morale: number;
  availability: AvailabilityState;
  injury: InjuryState | null;
  /** Ground the player calls home, if known — affects travel to away games. */
  homeGroundId: GroundId | null;
  /** Player-manager flag: they pick the team and play in it. */
  isPlayerManager: boolean;
  joinedClubOn: ISODate;
  record: PlayerRecord;
  /** Free-text impressions gathered about the player (scouting hooks). */
  notes: string[];
}

export type OfficialRole = 'manager' | 'assistant' | 'coach' | 'chairman' | 'secretary' | 'treasurer' | 'volunteer' | 'referee';

export interface OfficialAttributes {
  coaching: number;
  manManagement: number;
  motivation: number;
  tacticalKnowledge: number;
  recruitmentEye: number;
  organisation: number;
  /** Referees only; 1-20. */
  strictness?: number;
  consistency?: number;
}

export interface Official extends PersonBase {
  kind: 'official';
  role: OfficialRole;
  clubId: ClubId | null;
  attributes: OfficialAttributes;
  /** Managers can be under pressure; chairmen have patience. */
  patience: number;
  notes: string[];
}

export type Person = Player | Official;

export function isPlayer(person: Person | undefined | null): person is Player {
  return !!person && person.kind === 'player';
}

export function isOfficial(person: Person | undefined | null): person is Official {
  return !!person && person.kind === 'official';
}

export function personDisplayName(person: Person): string {
  return person.nickname ? `${person.firstName} '${person.nickname}' ${person.surname}` : `${person.firstName} ${person.surname}`;
}

export function shortName(person: Person): string {
  return `${person.firstName.charAt(0)}. ${person.surname}`;
}

export type { PlayerId };
