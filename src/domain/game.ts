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
import type { SeasonRecord } from './history';

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
 * 24 — the district next door. A career written before the county had a second
 *     league is *marked* as waiting for one when it is opened, and gains it at
 *     its next season boundary rather than in the middle of the season it is
 *     already playing: the district is founded as the roll-over begins, and the
 *     season that follows is built for both ladders in one go. Nothing the
 *     career already holds moves — not a club, a town, a ground, a person, a
 *     competition, a date or a result — because founding a district is
 *     additive. The marker is spent exactly once, so a career that has been
 *     through the boundary is never given a second district, and a save written
 *     before this version that is *already* a two-ladder world is marked as
 *     answered rather than expanded again.
 * 25 — the season archive. The competitions of the season that has just been
 *     played are written down as it closes — every division's final table, and
 *     for every cup its entrants, its rounds with their ties and results, and
 *     the club that won it — so that the season survives the roll-over that
 *     replaces the whole world of competitions a moment later. A version 24
 *     save is given an empty archive: it played its seasons before the record
 *     existed, its tables are not kept anywhere the game could honestly read
 *     them back from, and inventing a history is worse than having none. Its
 *     clubs keep the honours, seasons and movements they already had.
 * 26 — the county has a name. 'Alderfordshire' is the setting a career is played
 *     in rather than a fact about its seed, and the county's cup is *the
 *     Alderfordshire County Cup* rather than the word for the kind of thing it
 *     is. A version 25 save is brought forward whole: the cup it holds, the
 *     honours written in its old words and the copy of the name the season
 *     archive keeps are renamed with it, while the valleys, towns, clubs and
 *     people the seed drew are left exactly as they were.
 * 27 — the county. A county is an entity with an id of its own rather than a name
 *     on the world: it owns the regions its map is drawn from, every town is in
 *     the county its region is in, and a ladder belongs to the county its region
 *     is in. That is what makes a county cup a competition drawn from one
 *     county's clubs rather than from every club in the world, and two counties'
 *     cups two competitions. A version 26 save is given exactly one county, named
 *     what it already called itself, holding every region, town and ladder it
 *     already has. Nothing moves: no club, town, competition, fixture, date or
 *     honour, and the county cup keeps the id and the name it has always had.
 * 28 — the whole county. Alderfordshire has six districts, and a career is
 *     founded in all of them: six ladders of three divisions, six League Cups,
 *     six Plates and the county cup they all meet in. A version 27 save — or one
 *     older still — is marked on load with the districts it does not have, and
 *     is given them at its next season boundary, one boundary only and never
 *     twice: which districts a career is missing is read off the regions it
 *     holds, so a career given four now is not given them again next season. A
 *     career founded with one or two ladders keeps every club, ground, town,
 *     person, competition, fixture, result and honour it has; the new football
 *     is founded beside it rather than through it.
 */
export const GAME_STATE_VERSION = 28;

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

/**
 * Where a career stands on the districts it does not have yet.
 *
 * A career founded with the whole county starts with all six and never carries
 * this record at all. A career that predates a district is given the record when
 * it is first opened: `pending` is true while the world is missing football, and
 * the districts it is missing are founded at the next season boundary — which is
 * the whole point of writing it down, because a ladder cannot be spliced into a
 * season whose fixtures are half played without inventing results. Once the
 * boundary has passed, `pending` is false and `expandedInSeasonId` names the
 * season the districts were founded in.
 *
 * It is a marker rather than a derivation on purpose. "One ladder" is a fact
 * about the world, and a ladder could in principle be the only one a career ever
 * has; whether the county's other districts *belong* to this career is a question
 * that is asked once, at the moment the save is opened, and its answer is kept.
 * *Which* districts it is owed is deliberately not written here: that is read off
 * the regions the world holds against the county's authored districts
 * (`missingDistricts`), so a career given four districts at one boundary is not
 * given them again at the next one, and a save whose mark and world disagree is
 * believed about its world rather than about its mark.
 */
export interface WorldExpansionState {
  /** True until a season boundary founds the districts the county is owed. */
  pending: boolean;
  /** The season the districts were founded in, once they have been. */
  expandedInSeasonId?: SeasonId;
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
  /**
   * Whether this career is waiting for the county's second district, and where
   * that question was settled. Absent on a career founded with both ladders —
   * see {@link WorldExpansionState}.
   */
  worldExpansion?: WorldExpansionState;
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
  /**
   * The competitions of every season that has finished, oldest first.
   *
   * Written as each season closes and never written to again, because the
   * competitions it describes are rebuilt at the boundary and last season's
   * bracket, field and final table would otherwise be unreachable the moment the
   * new calendars existed. Bounded by `SEASON_HISTORY_LIMIT`; absent on a save
   * written before it existed, which reads as an empty archive.
   */
  seasonHistory: SeasonRecord[];
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
