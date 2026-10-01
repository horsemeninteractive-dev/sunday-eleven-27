import type { Club } from './club';
import type { Competition, FixtureList } from './competition';
import type { ScheduleState } from './events';
import type { ClubId, CompetitionId, ISODate, MatchId, PersonId, SeasonId } from './ids';
import type { ManagerProfile } from './manager';
import type { Match } from './match';
import type { NewsItem } from './news';
import type { Person } from './person';
import type { RecruitmentStore } from './recruitment';
import type { RelationshipStore } from './relationship';
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
 */
export const GAME_STATE_VERSION = 7;

export type GamePhase = 'preseason' | 'season' | 'complete';

export interface StandingSnapshot {
  date: ISODate;
  matchday: number;
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
  phase: GamePhase;
  season: SeasonState;
  world: World;
  clubs: Record<ClubId, Club>;
  people: Record<PersonId, Person>;
  /** The social layer: Person → Relationship → Club. */
  relationships: RelationshipStore;
  /** What the manager knows about people he might bring in, and how he found them. */
  recruitment: RecruitmentStore;
  /** Thursday nights: the week's plan, what happened, and what it has built. */
  training: TrainingStore;
  competitions: Record<CompetitionId, Competition>;
  fixtures: FixtureList;
  matches: Record<MatchId, Match>;
  /** Player's own club. */
  userClubId: ClubId;
  /** The manager himself: identity the career keeps and ages with him. */
  managerProfile: ManagerProfile;
  /** Match ids in kick-off order for the season. */
  matchOrder: MatchId[];
  news: NewsItem[];
  /** Weekly standing snapshots — the raw material of the archive. */
  standingHistory: StandingSnapshot[];
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
  championClubId: ClubId | null;
  playerClubId: ClubId;
  playerClubPosition: number | null;
  playerClubPoints: number;
}
