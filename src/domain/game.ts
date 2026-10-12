import type { AdminState } from './admin';
import type { CareerState } from './career';
import type { FacilitiesState } from './facilities';
import type { FundraisingState } from './fundraising';
import type { CommunicationStore } from './communication';
import type { GovernanceState } from './governance';
import type { Club } from './club';
import type { Competition, FixtureList, MovementRecord, Pyramid } from './competition';
import type { ScheduleState } from './events';
import type { ClubId, CompetitionId, ISODate, MatchId, PersonId, PyramidId, SeasonId } from './ids';
import type { ManagerProfile } from './manager';
import type { Match } from './match';
import type { NewsItem } from './news';
import type { Person } from './person';
import type { CustomFormation } from './positions';
import type { PressState } from './press';
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
 * 17 — the manager's own career. Whether he is in charge of a club or between
 *     jobs, the clubs he has managed and the posts he can apply for while he is
 *     out of work. A version 16 save is given an employed career at the club it
 *     was already managing — nobody had been sacked yet, so nobody wakes up out
 *     of work.
 * 18 — fundraising. The quiz nights, raffles and pub events a club has put on,
 *     and what they took. A version 17 save is given an empty record: its money
 *     is already in the ledger, and inventing nights it never ran would invent
 *     income it never earned.
 * 19 — the ground. The jobs a club has commissioned on its own pitch, and the
 *     standing upkeep it pays to hold what it has. A version 18 save is given an
 *     empty record: nobody had commissioned anything, so nobody wakes up with a
 *     contractor on the site — and its grounds keep the surface, the drainage
 *     and the facilities they already had, as the baseline their own work is
 *     measured from.
 * 20 — the local football world. The press: the papers and people who cover the
 *     county, the patch each reporter follows, and the claims they have filed
 *     that the world has not settled yet. The same version carries the two
 *     things the world reacts to them with: a rivalry now knows what it is worth
 *     when nothing is happening (`baseline`) as opposed to the temporary heat of
 *     recent meetings, and every club has a crowd with an opinion. A version 19
 *     save wakes up with a press generated from its own world seed — the same
 *     reporters, papers and patches it would have had if the press had always
 *     been in the build — with each existing rivalry kept exactly as it was, its
 *     intensity treated as the waterline, and every club given the crowd it
 *     deserves and no invented history about it.
 * 21 — club heritage and the committee's appeal. A club minted at a season
 *     boundary now says which club it replaced and what it kept of it, so a
 *     reformation — the same name, the same shirts, the same ground, the same
 *     crowd and the same rivalries, and none of the debt — can be told from a
 *     new club simply taking a dead one's place. The same version carries the
 *     one-off appeal a committee makes when its club goes into the red. A
 *     version 20 save is given neither: absent heritage means exactly what it
 *     says, and a club that never appealed has not. What it does get is the one
 *     thing the old cycle left lying about — a club that had folded was still
 *     named as somebody's rival, and those references are cleared, because a
 *     club that has gone is nobody's rival.
 * 22 — cup round identity. A cup tie now carries the round it was drawn for,
 *     rather than having the round read back out of its matchday number, so two
 *     competitions can share a Sunday without either one's round being read as
 *     the other's. A version 21 save has the field back-filled on every tie from
 *     the arithmetic it was already being read with, which is why nothing in it
 *     changes: no date moves, no result is revisited, and no bracket is redrawn.
 *     League fixtures and friendlies are untouched, and a competition that could
 *     not be placed is left on the fallback rather than being given a round
 *     number it never had.
 * 23 — regions and pyramids. The world now says which region each of its towns
 *     is in, and the ladder a career plays on is a pyramid with an id of its own
 *     holding its shape and the competitions it owns, in place of a single
 *     loose configuration. A version 22 save is given exactly one region, around
 *     every town it already has, and exactly one pyramid, whose id is `league`:
 *     that id is already the prefix of every competition the save holds, so no
 *     competition is renamed, no match is re-homed, no club changes division and
 *     no date moves. The towns keep their names, positions and population, the
 *     clubs keep their squads, staff and history, and the ladder keeps the shape
 *     it was generated with — the migration is a new way of describing the world
 *     it already had.
 */
export const GAME_STATE_VERSION = 23;

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
  /**
   * The local press: the papers that cover this county, the reporters on their
   * patches, and the claims they have filed that the world has not settled yet.
   */
  press: PressState;
  /** The manager's own career: where he manages, and where he has. */
  career: CareerState;
  /** The club's own fundraising: quiz nights, raffles and pub events, and what they took. */
  fundraising: FundraisingState;
  /**
   * The club's ground: the jobs it has commissioned on its own pitch, and the
   * upkeep it pays to hold what it has. The ground itself stays in
   * `world.grounds`, because that is where the rest of the game reads it.
   */
  facilities: FacilitiesState;
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
   * The county's pyramids of football, keyed by id, and the order the world
   * reads them in — the founding ladder first.
   *
   * Each pyramid holds its own shape (divisions, clubs per division, places
   * swapped at a boundary, whether the cups run) and owns its own competitions,
   * persisted rather than read from the defaults so a save keeps the ladder it
   * was generated with. This replaced a single `pyramid: PyramidConfig` when the
   * founding pyramid became the first of however many the county ends up with:
   * with the founding pyramid's id being `league`, every competition id already
   * written stays exactly where it is.
   */
  pyramids: Record<PyramidId, Pyramid>;
  /** The world's ladders in the order it reads them: the founding pyramid first. */
  pyramidIds: PyramidId[];
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
