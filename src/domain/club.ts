import type { ClubId, GroundId, ISODate, PersonId, PlayerId, SeasonId, TownId } from './ids';
import type { Tactics } from './tactics';
import type { BadgeChoice } from './badge';
import type { ClubStaff } from './staff';

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

/**
 * What a rivalry actually is.
 *
 * Two clubs can be on bad terms for reasons that have nothing to do with each
 * other, and the game has to be able to tell them apart:
 *
 *   - a **derby** is geography. Two villages a mile apart will play each other
 *     for a hundred years whatever the table says, and that does not cool.
 *   - a **historic** rivalry was earned — a run of tight games, a cup tie, a
 *     signing raid — and outlasts the people who made it.
 *   - **competitive** tension is the weather: a title race, a relegation six-
 *     pointer, a bad-tempered afternoon. It fades when the football moves on.
 *
 * The distinction is what stops a single close game turning into a blood feud.
 * Only the third kind is created by a result.
 */
export type RivalryKind = 'derby' | 'historic' | 'competitive';

export const RIVALRY_KIND_LABEL: Record<RivalryKind, string> = {
  derby: 'Local derby',
  historic: 'Old rivalry',
  competitive: 'Competitive tension',
};

/**
 * One club's view of another.
 *
 * `intensity` is what everything in the game already reads — the crowd, the
 * paper, the scouting report — and it stays the single number those readers use.
 * What is new is that it now has two halves that can be told apart:
 *
 *   - `baseline` is the waterline: what these two clubs are to each other when
 *     nothing is happening. A derby's is high and does not move; a competitive
 *     rivalry's is low;
 *   - the rest is **heat**, the temporary consequence of recent meetings, and
 *     heat is the only part that cools. A season without the fixture takes the
 *     temperature down to the waterline and no further, so a rivalry can settle
 *     without being forgotten.
 *
 * Intensity is always `baseline + heat`, clamped. Both are stored rather than one
 * being derived from the other, because the waterline is what a cooling rule
 * needs to know and it cannot be recovered from a single number.
 */
export interface ClubRivalry {
  intensity: number;
  note: string;
  /**
   * What is left when the temperature drops: 0-98.
   *
   * Absent on a relationship written before this field existed. Absent means
   * "unknown, and therefore the same as the intensity it already has" — a save
   * that predates the model keeps exactly the rivalry it had, and never has one
   * invented for it.
   */
  baseline?: number;
  kind?: RivalryKind;
  /** When the two clubs first became something to each other. */
  since?: ISODate;
  /** The last time they met, which is how staleness is judged. */
  lastMetOn?: ISODate | null;
  /** Meetings that mattered: close, in a cup, or bad-tempered. */
  meetings?: number;
  /**
   * The part of the intensity that is this season's weather.
   *
   * Stored rather than derived, because cooling has to know what to take away
   * and a single number cannot say. `intensity` stays `baseline + heat`, clamped,
   * so every reader that existed before this field did reads exactly what it
   * always read. Absent means 0 — nothing temporary has happened yet, or the
   * save predates the model and its intensity is all waterline.
   */
  heat?: number;
}

/**
 * The people who pay at the gate.
 *
 * Aggregate on purpose. A Sunday club has perhaps eighty regulars and a game
 * this game simulates is eleven-a-side, not eight hundred individual supporters
 * with moods of their own — what the manager can actually feel is whether the
 * place is up or down, and that is one number plus the reason for its last
 * move.
 *
 * Confidence is 0-100 around a midpoint of 50: a club nobody has an opinion
 * about. It moves slowly, by bounded amounts, and mostly because of football
 * that has actually been played.
 */
export interface ClubSupporters {
  /** 0-100. 50 is "neither up nor down". */
  confidence: number;
  updatedOn: ISODate;
  /** The last few movements, newest first, with the reason for each. */
  recent: Array<{ date: ISODate; delta: number; reason: string }>;
}

export function defaultSupporters(date: ISODate): ClubSupporters {
  return { confidence: 50, updatedOn: date, recent: [] };
}

/** How many movements of supporter mood are worth remembering. */
export const SUPPORTER_HISTORY_LIMIT = 8;

export interface ClubFinances {
  balance: number;
  /**
   * The balance the club started from, before any ledger line in `ledger`.
   *
   * The ledger is the record of every real transaction, and the balance is
   * meant to be exactly `openingBalance + sum(ledger)`. Keeping the opening
   * figure explicit is what lets that identity hold even when the ledger is
   * trimmed of its oldest lines: the trimmed total is folded back into here
   * rather than quietly lost, so the books never fail to add up.
   */
  openingBalance: number;
  /**
   * Legacy weekly subscription figure.
   *
   * Kept so saves and the club-generation template still load, but no longer
   * charged: subs are a per-match liability now, priced by {@link starterSubAmount}
   * and {@link substituteSubAmount}. Nothing settles the squad against this field.
   */
  subscriptionPerPlayer: number;
  /** What a player who started is charged for the match he played. */
  starterSubAmount: number;
  /** Reduced rate for a named substitute who actually came on. */
  substituteSubAmount: number;
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
  /**
   * The day the committee last appealed to the town for money.
   *
   * The flag as well as the date: one appeal per spell in administration, and
   * cleared the moment the club is solvent again, so a club that falls twice
   * has to earn a second one by first getting its books straight. A club that
   * has never appealed simply has no field.
   */
  appealedOn?: ISODate | null;
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
  /** Work commissioned on the club's own ground, and its upkeep. */
  | 'ground'
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

/**
 * Whether the club that took a folded club's place is the club that went, or a
 * different one wearing its shirt.
 *
 * The distinction is the whole point of the pair: a **reformation** is the same
 * club brought back — the name, the shirts, the ground and the crowd that
 * watched it — and a **successor** is simply the new club a town forms when
 * somebody else's has gone. Only the first is a continuation, and only the first
 * inherits anything.
 */
export type ClubHeritageKind = 'reformed' | 'successor';

export const CLUB_HERITAGE_LABEL: Record<ClubHeritageKind, string> = {
  reformed: 'Re-formed club',
  successor: 'Successor club',
};

/**
 * Where a club came from, when it did not simply begin.
 *
 * A club minted at a season boundary is always somebody's successor, so this is
 * the link the archive reads to tell a hundred-year-old club's latest chapter
 * from a club that has been here all along. It is a *reference*: the club it
 * names still exists, inactive, with its own name, seasons and honours, and
 * nothing about it is rewritten — which is what keeps the record of a folded
 * club and the record of the club that replaced it separate facts.
 */
export interface ClubHeritage {
  /** The club whose place this one takes. Never itself; never active. */
  predecessorId: ClubId;
  predecessorName: string;
  /** The year the predecessor was founded, so the line can say what it continues. */
  predecessorFounded: number;
  kind: ClubHeritageKind;
  /** The day the new club came into being: the season it stepped into. */
  since: ISODate;
  /** What came across with it, named for the paper's benefit. */
  inherited: string[];
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
  /**
   * The club's other personnel: assistant, coaches, physio, secretary,
   * treasurer, scouts and volunteers. Manager and chairman stay above, because
   * they predate this and are read all over the game. A Sunday club may leave
   * most of these empty, and one person may hold more than one of them.
   */
  staff: ClubStaff;
  sponsorIds: string[];
  /** The manager's default approach; AI clubs keep this for the season. */
  tactics: Tactics;
  finances: ClubFinances;
  history: ClubHistory;
  /** False once a club folds; kept in the archive. */
  active: boolean;
  /**
   * How this club came to exist, when it replaced one that folded.
   *
   * Absent on every club the world generated and on every club formed before
   * this existed, which is exactly what it means: this club simply began.
   */
  heritage?: ClubHeritage;
  /** Local derby/club relationships, keyed by opponent. */
  rivalries: Record<ClubId, ClubRivalry>;
  /**
   * The people who watch them: one aggregate number, and why it last moved.
   *
   * Required rather than optional, so every club the game builds has a crowd
   * with a view — and so a save written before this existed is given one by the
   * migration rather than by every reader remembering to guess.
   */
  supporters: ClubSupporters;
  /**
   * Which of this season's offered kit designs the club runs out in.
   *
   * The only part of a kit that is stored: the strips themselves are generated
   * from the seed and the season, so a career that rolls into a new season has
   * a new kit without a migration. Absent means the first design.
   */
  kitChoice?: number;
  /**
   * The season label this club last picked a kit for.
   *
   * `kitChoice` alone cannot say whether the manager has *chosen* this season or
   * is merely wearing whatever the first design was, because absent and "design
   * one" mean the same thing. This is the difference between "we are in a new
   * season and the shirts have arrived" and "that was settled last July", which
   * is what decides whether the kit screen is still worth offering.
   */
  kitSeason?: string;
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
