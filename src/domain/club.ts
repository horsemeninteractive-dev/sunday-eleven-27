import type { ClubId, GroundId, ISODate, PersonId, PlayerId, SeasonId, TownId } from './ids';
import type { Tactics } from './tactics';
import type { BadgeChoice } from './badge';

export type ClubStructure = 'committee' | 'members' | 'pub-backed' | 'business-backed' | 'community' | 'chairman-led';

export const CLUB_STRUCTURE_LABEL: Record<ClubStructure, string> = {
  committee: 'Committee run',
  members: "Members' club",
  'pub-backed': 'Pub backed',
  'business-backed': 'Business backed',
  community: 'Community club',
  'chairman-led': 'Chairman led',
};

export interface ClubIdentity {
  name: string;
  shortName: string;
  nickname: string;
  foundedYear: number;
  colours: { primary: string; secondary: string };
  /** Free-text identity line used in the club view. */
  motto: string;
}

export interface ClubFinances {
  balance: number;
  /** Recurring weekly costs/income recorded as ledger lines from the templates. */
  subscriptionPerPlayer: number;
  sponsorIncomePerWeek: number;
  weeklyGroundCost: number;
  /** Training pitch and floodlight hire, where the club has to pay for it. */
  trainingCostPerWeek: number;
  insurancePerWeek: number;
  /** Applied at the start of each season. */
  annualLeagueFee: number;
  /**
   * Consecutive seasons the club has ended in the red. Absent or 0 means it is
   * solvent. A club that cannot get out of the red after a few of these folds.
   */
  administrationSeasons?: number;
  ledger: LedgerEntry[];
}

export type LedgerCategory =
  | 'subs'
  | 'sponsorship'
  | 'matchday'
  | 'fundraising'
  | 'pitch-hire'
  | 'referee'
  | 'league-fee'
  | 'insurance'
  | 'equipment'
  | 'signing'
  | 'fines'
  | 'other';

export interface LedgerEntry {
  id: string;
  date: ISODate;
  description: string;
  category: LedgerCategory;
  /** Positive = money in, negative = money out. */
  amount: number;
  balanceAfter: number;
}

export interface ClubSeasonRecord {
  seasonId: SeasonId;
  seasonLabel: string;
  competitionName: string;
  /**
   * Which division of the pyramid this season was played in: 1 is the top.
   *
   * Stored rather than derived because the ladder moves. A club's season in
   * Division One and its season in Division Three are not the same achievement,
   * and the archive has to be able to say which one a record belongs to.
   * Null for a season that predates the pyramid.
   */
  tier: number | null;
  /**
   * How this season ended for the club: promoted, relegated, or neither.
   * Set at the season boundary and shown in the archive beside the table.
   */
  movement?: 'promoted' | 'relegated';
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  finalPosition: number | null;
}

export interface ClubHistoryEvent {
  date: ISODate;
  seasonLabel: string;
  description: string;
  importance: 1 | 2 | 3;
}

export interface ClubHistory {
  founded: number;
  seasons: ClubSeasonRecord[];
  /** Most recent first. */
  notableEvents: ClubHistoryEvent[];
  honours: string[];
  managers: Array<{ personId: PersonId; name: string; from: ISODate; to: ISODate | null }>;
  records: {
    recordAppearanceHolderId: PlayerId | null;
    recordGoalscorerId: PlayerId | null;
    biggestWin: string | null;
  };
}

export interface Club {
  id: ClubId;
  identity: ClubIdentity;
  townId: TownId;
  groundId: GroundId;
  structure: ClubStructure;
  /** 1-100: standing in the local pyramid, drives gossip/recruitment reach. */
  reputation: number;
  squadIds: PlayerId[];
  chairmanId: PersonId | null;
  managerId: PersonId | null;
  sponsorIds: string[];
  /** The manager's default approach; AI clubs keep this for the season. */
  tactics: Tactics;
  finances: ClubFinances;
  history: ClubHistory;
  /** False once a club folds; kept in the archive. */
  active: boolean;
  /** Local derby/club relationships, keyed by opponent. */
  rivalries: Record<ClubId, { intensity: number; note: string }>;
  /**
   * Which of this season's offered kit designs the club runs out in.
   *
   * The only part of a kit that is stored: the strips themselves are generated
   * from the seed and the season, so a career that rolls into a new season has
   * a new kit without a migration. Absent means the first design.
   */
  kitChoice?: number;
  /**
   * The badge the manager designed for this club, if he designed one.
   *
   * Absent for every club the world generated, which wears the badge the
   * generator gave it — and absent per field for a club that only chose some of
   * it, so a half-designed badge falls back for the rest rather than for all.
   */
  badge?: BadgeChoice;
}

export interface StandingRow {
  clubId: ClubId;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: Array<'W' | 'D' | 'L'>;
}
