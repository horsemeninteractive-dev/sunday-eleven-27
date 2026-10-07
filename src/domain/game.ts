import type { AdminState } from './admin';
import type { CommunicationStore } from './communication';
import type { GovernanceState } from './governance';
import type { Club } from './club';
import type { Competition, FixtureList, MovementRecord, PyramidConfig } from './competition';
import type { ScheduleState } from './events';
import type { ClubId, CompetitionId, ISODate, MatchId, PersonId, SeasonId } from './ids';
import type { ManagerProfile } from './manager';
import type { Match } from './match';
import type { NewsItem } from './news';
import type { Person } from './person';
import type { CustomFormation } from './positions';
import type { RecruitmentStore } from './recruitment';
import type { RelationshipStore } from './relationship';
import type { SponsorshipState } from './sponsorship';
import type { TrainingStore } from './training';
import type { SeasonState, World } from './world';
import type { StandingRow } from './club';

/**
 * Save format version.
 *
 * 1 — the original vertical slice.
 * 2 — adds the social layer (`relationships`). Version 1 saves are migrated on
 *     load: the initial network is regenerated deterministically from the seed.
 * 3 — adds the unattached player pool and recruitment (`recruitment`).
 * 4 — adds weekly training (`training`) and the tactical familiarity each
 *     player has with his club's way of playing.
 * 5 — adds the manager's calendar cursor (`calendarCursor`): the day he is
 *     standing on inside the week that ends on the coming Sunday.
 * 6 — continuous time. The cursor *is* the date now, and every system that used
 *     to think in weeks schedules against the calendar instead. Version 5 saves
 *     keep their date and drop the cursor: the day the manager was standing on
 *     is the day the career resumes from.
 * 7 — the manager's own profile (name, birthday, occupation, hometown). Older
 *     saves derive one from the manager official they already carry.
 * 8 — the pyramid. Several concurrent competitions (a ladder of league
 *     divisions plus cups), each with its own fixtures, standings and honours.
 *     Version 7 saves carry one league and no cups: the migration keeps that
 *     league as Division One, generates the divisions below it from the world
 *     seed, and stamps `tier: 1` on the history a single-division career
 *     already had.
 * 9 — development curves. Every player carries his own ceiling and his own age
 *     to reach it, which is what stops the world's football improving for ever,
 *     and a training session now records the attributes age took back. Version
 *     8 saves are given a profile derived from the ability and age each player
 *     already had, so an old career does not suddenly discover a new talent in
 *     its established men.
 * 10 — communication. Every conversation the manager has with players, staff,
 *     the board, the league and anybody trying to join the club, with every
 *     message in it, its intent, who has read it and what it expects to cause.
 *     Version 9 saves have no conversations yet — there is nothing to invent,
 *     because a career that had none should not wake up with any — so they are
 *     given an empty inbox and the world carries on around them.
 * 11 — matchday subs. Subs stopped being a weekly squad tax and became a
 *     per-match liability raised from the engine's participation record.
 * 12 — the club personnel system: assistant, coach, physio, secretary,
 *     treasurer, scout and volunteer as real people with roles and a roster.
 * 13 — the secretary's desk. Club administration — registrations, deadlines,
 *     AGMs, fixture correspondence, disciplinary notices — is received, kept
 *     and closed here. Version 12 saves are given an empty desk, because a
 *     career that had no paperwork should not wake up to a pile of it.
 * 14 — club governance: the chairman's expectations, concerns and standing, and
 *     the notable decisions the committee has taken. Version 13 saves are given
 *     a comfortable committee that has taken no view yet.
 * 15 — sponsorship. A club's sponsor is a real local business with an actual
 *     agreement — a start, a term, an instalment and a payday — rather than a
 *     weekly financial modifier. Version 14 saves are given an empty deal log,
 *     because an agreement that was never signed should not be invented, and
 *     the clubs that already had a backing business will sign one in play.
 * 16 — shapes. A manager can move anybody on the preparation pitch and keep the
 *     result under a name, so a career carries the formations he has built as
 *     well as the ones it was born with. A version 15 save is given an empty
 *     book: nobody had built one, and inventing a shape would put a manager's
 *     name on a formation he never chose.
 */
export const GAME_STATE_VERSION = 16;

export type GamePhase = 'preseason' | 'season' | 'complete';

export interface StandingSnapshot {
  date: ISODate;
  matchday: number;
  /** The competition this table belongs to — one per division per matchday. */
  competitionId: CompetitionId;
  rows: StandingRow[];
  /** Position of the player's club, for history charts. */
  playerClubPosition: number | null;
}

export interface GameSettings {
  /** Simple/Standard toggles for future complexity modes; only standard exists. */
  complexity: 'standard';
  /** Whether the player's matches are auto-resolved without the match view. */
  autoAdvanceMatches: boolean;
}

export interface GameState {
  version: number;
  saveId: string;
  saveName: string;
  createdAt: ISODate;
  seed: string;
  /**
   * The current date. This is the single source of temporal truth: today, the
   * day the manager is living through. Every other timing fact in the game is
   * derived from it or scheduled against it.
   */
  date: ISODate;
  /**
   * The calendar itself: things systems have scheduled beyond the fixtures the
   * world already knows about, plus how far the manager has been told about
   * what is coming. Derived events (matches, training, subs day) are not stored
   * here, because they already have a home.
   */
  schedule: ScheduleState;
  /**
   * The secretary's desk: administrative events received, outstanding and
   * closed. Informational only — no fixture or competition fact lives here.
   */
  admin: AdminState;
  /** The committee's view of the manager: expectations, concerns and standing. */
  governance: GovernanceState;
  /** The club's sponsorship agreements: who backs it, for how much, and until when. */
  sponsorship: SponsorshipState;
  phase: GamePhase;
  season: SeasonState;
  world: World;
  clubs: Record<ClubId, Club>;
  people: Record<PersonId, Person>;
  /** The social layer: Person → Relationship → Club. */
  relationships: RelationshipStore;
  /**
   * The shapes the manager has built on the preparation pitch, under his own
   * names, for as long as the career lasts.
   */
  customFormations: CustomFormation[];
  /** What the manager knows about people he might bring in, and how he found them. */
  recruitment: RecruitmentStore;
  /** Thursday nights: the week's plan, what happened, and what it has built. */
  training: TrainingStore;
  /**
   * Everything the manager has been told, and everything he has said back:
   * conversations, messages, read state, and the intent each message was sent
   * with. Held on the state like the other stores so a save carries the inbox
   * with it.
   */
  communication: CommunicationStore;
  competitions: Record<CompetitionId, Competition>;
  /**
   * The shape of the ladder this career was generated with: divisions, clubs
   * per division, places swapped at each boundary, and whether the cups run.
   * Persisted rather than read from the defaults so a save keeps its own shape.
   */
  pyramid: PyramidConfig;
  /** Fixture lists, one per competition. */
  fixtures: Record<CompetitionId, FixtureList>;
  matches: Record<MatchId, Match>;
  /** Player's own club. */
  userClubId: ClubId;
  /** The manager himself: identity the career keeps and ages with him. */
  managerProfile: ManagerProfile;
  /** Match ids in kick-off order for the season. */
  matchOrder: MatchId[];
  news: NewsItem[];
  /** Weekly standing snapshots, one per division per matchday. */
  standingHistory: StandingSnapshot[];
  /**
   * Every movement across a boundary, for the whole career.
   *
   * Appended to at each season close, so a promoted club's history reads as a
   * story across seasons rather than a line that stops when it changed tier.
   */
  promotionHistory: MovementRecord[];
  settings: GameSettings;
  /** Id of the last match the player's club was involved in. */
  lastMatchId: MatchId | null;
  /** Match awaiting kick-off in the match view. */
  pendingMatchId: MatchId | null;
  /** Monotonic counters so generated ids stay stable across a save. */
  counters: Record<string, number>;
}

export interface SeasonSummary {
  seasonId: SeasonId;
  label: string;
  competitionName: string;
  /** Division the player's club played in this season: 1 is the top. */
  tier: number | null;
  championClubId: ClubId | null;
  playerClubId: ClubId;
  playerClubPosition: number | null;
  playerClubPoints: number;
}
