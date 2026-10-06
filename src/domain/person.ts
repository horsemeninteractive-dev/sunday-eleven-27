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

/**
 * How a player took part in a match, as far as the subs book is concerned.
 *
 * The Match Engine is authoritative for this: a starter is one the engine
 * recorded as starting, a substitute is one it recorded as coming on. A man on
 * the bench who was never used is not named here at all, because he owes
 * nothing for a game he did not play.
 */
export type PlayerSubParticipation = 'starter' | 'substitute';

/**
 * A liability's kind: a real match participation, or a balance carried over
 * from a save written before subs were per-match (`carried`). The carried kind
 * exists only so an old, already-recorded balance is preserved rather than
 * quietly dropped when the next match is settled — it is never charged for a
 * match, because no match is fabricated to explain it.
 */
export type PlayerSubCategory = PlayerSubParticipation | 'carried';

/**
 * One match's subs charge against one player.
 *
 * Subs are a matchday liability, not a weekly squad tax. Each match a man
 * played creates his own liability, and they are never merged: the club has to
 * be able to answer "why does this player owe £8?" with "£5 from the cup tie and
 * £3 from Sunday". A liability keeps its amount, whatever has been paid against
 * it, and the date it was settled.
 *
 * `id` is derived from the match and the player (`<matchId>:<playerId>`) so that
 * settling the same completed match twice cannot double-charge anybody.
 */
export interface PlayerSubLiability {
  id: string;
  /** The completed match that generated this liability. */
  matchId: string;
  /** The date of that match — the day the charge was incurred. */
  date: ISODate;
  category: PlayerSubCategory;
  /** What the match cost him. Never changes; `paid` records what has come in. */
  amount: number;
  /** How much of `amount` has actually arrived. Never more than `amount`. */
  paid: number;
  /** The date the liability was settled in full, or null while it is short. */
  paidOn: ISODate | null;
}

/** A real payment, recorded when money actually changes hands. */
export interface PlayerSubPayment {
  id: string;
  date: ISODate;
  amount: number;
}

/**
 * What a player owes the club.
 *
 * The club's money has always been authoritative and stays that way: the ledger
 * says what arrived, the balance says what is in the account, and neither is
 * touched by anything anybody says. This record is the one thing the ledger
 * could not say — *whose* money did not arrive.
 *
 * `owed` and `missedWeeks` are summaries kept for the conversation layer, which
 * has always read them. They are derived from `liabilities` whenever the book
 * moves, and the liabilities themselves are the truth: a man's debt is the sum
 * of the matches he played and has not squared up.
 *
 * A promise is deliberately not a field. Promises live on the conversation that
 * made them, because a promise is a thing a man said, not a thing that happened.
 */
export interface PlayerSubs {
  /** Outstanding across every unpaid match liability, in pounds. */
  owed: number;
  /** How many match liabilities are still short. 0 when level. */
  missedWeeks: number;
  /** When the money last actually arrived. */
  lastPaidOn: ISODate | null;
  /** Every match liability ever raised, oldest first. */
  liabilities?: PlayerSubLiability[];
  /** Every real payment, oldest first. */
  payments?: PlayerSubPayment[];
}

export function emptyPlayerSubs(): PlayerSubs {
  return { owed: 0, missedWeeks: 0, lastPaidOn: null, liabilities: [], payments: [] };
}

/** How much of one liability is still outstanding. */
export function outstandingOnLiability(liability: PlayerSubLiability): number {
  return Math.round((liability.amount - liability.paid) * 100) / 100;
}

/**
 * Re-derive the summaries from the liabilities.
 *
 * Called after the book moves, so `owed` and `missedWeeks` can never drift from
 * the liabilities the conversation layer is told about.
 */
export function refreshSubSummary(subs: PlayerSubs): void {
  const liabilities = subs.liabilities ?? [];
  let owed = 0;
  let outstanding = 0;
  for (const liability of liabilities) {
    const due = outstandingOnLiability(liability);
    if (due > 0) {
      owed += due;
      outstanding += 1;
    }
  }
  subs.owed = Math.round(owed * 100) / 100;
  subs.missedWeeks = outstanding;
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

/**
 * Where a player is going, as opposed to where he is.
 *
 * Training used to raise a man's attributes until he hit the top of the scale,
 * which meant every player in the world got slowly better every year and the
 * world's football never stopped improving. Giving each player his own ceiling
 * and his own age to get there turns that ratchet into a curve: a teenager has
 * a long way to travel and all the time in the world to travel it, a man of 29
 * is closing in on what he has, and a man of 34 has stopped getting better and
 * started losing it.
 *
 * Neither number is shown to the manager as a number. The scouting view reads
 * them as a rough judgement; here they are simply the shape of a career.
 */
export interface PlayerDevelopment {
  /**
   * The mean ability he is working towards, on the same 1–20 scale as his
   * attributes. He improves towards this and no further, and once he is level
   * with it he is done, however much he trains.
   */
  potential: number;
  /** The age he is expected to be at his best. */
  peakAge: number;
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
  /** His own ceiling and his own peak: the shape of his career. */
  development: PlayerDevelopment;
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
  /** What he owes the club, written by the finance system and by nothing else. */
  subs: PlayerSubs;
}

export type OfficialRole =
  | 'manager'
  | 'assistant'
  | 'coach'
  | 'physio'
  | 'chairman'
  | 'secretary'
  | 'treasurer'
  | 'scout'
  | 'volunteer'
  | 'referee';

/**
 * What a member of staff is good at.
 *
 * These are deliberately few and role-facing. A manager is judged on coaching,
 * man-management, motivation and tactical knowledge; a physio on whether he can
 * actually fix a hamstring; a treasurer on whether the books add up. There is no
 * attempt to give staff the full player attribute set — only the qualities the
 * game has a reason to look at.
 *
 * The later-role attributes are optional so that officials generated before the
 * staff system existed (managers, chairmen, referees) still load, and are read
 * through {@link officialAttribute} which supplies a sensible middle value.
 */
export interface OfficialAttributes {
  coaching: number;
  manManagement: number;
  motivation: number;
  tacticalKnowledge: number;
  recruitmentEye: number;
  organisation: number;
  /** 1-20: does he turn up and do it, week after week. */
  reliability?: number;
  /** 1-20: physio — diagnosing and treating injuries. */
  medical?: number;
  /** 1-20: treasurer — money sense. */
  financial?: number;
  /** 1-20: assistant/scout — reading a game and a player. */
  judgement?: number;
  /** 1-20: coach — bringing a player on. */
  development?: number;
  /** Referees only; 1-20. */
  strictness?: number;
  consistency?: number;
}

/**
 * Whether a member of staff is around this week.
 *
 * Staff are volunteers with day jobs: a scout works Saturdays, a physio has a
 * shift pattern, a secretary goes on holiday. Availability is deliberately
 * small — a status and a note — because it exists to explain why somebody is or
 * is not around, not to model a second fitness system.
 */
export interface StaffAvailability {
  status: 'available' | 'unavailable';
  note: string | null;
}

export interface Official extends PersonBase {
  kind: 'official';
  role: OfficialRole;
  clubId: ClubId | null;
  attributes: OfficialAttributes;
  /** Managers can be under pressure; chairmen have patience. */
  patience: number;
  notes: string[];
  /** Absent for staff generated before the club personnel system existed. */
  availability?: StaffAvailability;
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
