/**
 * A club has to be able to die, and a club has to be able to come back.
 *
 * Money in this world had no failure state: every side's balance only ever
 * climbed, so a club could be run into the ground for a decade and nothing
 * happened. Real local football is full of clubs that went under — a sponsor
 * walked, the pitch hire went up, the committee ran out of people — and of new
 * clubs that appear in the same town a season or two later, often on the same
 * pitch, with a new name and a new committee.
 *
 * Three turns of that cycle live here, all of them at the season boundary and
 * all of them out of state the game already keeps:
 *
 *   - **a club in the red appeals.** The committee's first act in
 *     administration is to ask the town, which raises a bounded, one-off sum
 *     priced on the club's own reach. It can save a club with a small debt and
 *     it cannot save a club with a large one, which is what makes the way out a
 *     possibility rather than a formality;
 *   - **a club that cannot get out folds.** Its players and committee go with
 *     it, its ground falls vacant, and its record stays in the archive;
 *   - **a club comes back in the same summer**, taking the place it left rather
 *     than leaving a hole in the division. Whether that club is the club that
 *     went or a different one is decided by what the club actually was — see
 *     `isReformation` — and that is the only thing that decides what comes
 *     across with it: a reformation keeps the name, the shirts, the ground, the
 *     crowd and the rivalries, and takes none of the debt, the squad, the
 *     committee or the trophies, while a successor starts with nothing but the
 *     town.
 */

import {
  defaultSupporters,
  type Club,
  type ClubHeritageKind,
  type ClubRivalry,
} from '@/domain/club';
import { MANAGER_PERSON_ID } from '@/domain/communication';
import type { GameState } from '@/domain/game';
import type { ClubId, GroundId, ISODate, SeasonId } from '@/domain/ids';
import type { GameEvent } from '@/domain/news';
import { isOfficial } from '@/domain/person';
import { Rng } from './rng';
import { styleTactics } from './ai/style';
import { yearOf } from './calendar';
import { generateSquad } from './generation/playerGenerator';
import {
  buildClubName,
  buildFinances,
  clubQualityFromReputation,
  emptyHistory,
  generateChairman,
  reputationForTown,
} from './generation/worldGenerator';
import { addLedgerEntry } from './finance';
import { createEvent } from './news';
import { removePersonFromCommunication } from './communication/store';
import { removePersonRelationships } from './relationships';
import { rivalryBaseline } from './rivalries';
import { stream } from './rng';
import { generateClubStaff } from './staff';
import { supportConfidenceOf } from './support';

/** Tunable, so the soak decides how often a club actually dies. */
export const CLUB_LIFECYCLE = {
  /** Consecutive seasons a club can end in the red before it folds. */
  graceSeasons: 3,
  /** A debt this deep folds a club outright, however recently it went under. */
  terminalDebt: -4000,
  /** How far a bad finish cuts a club's standing. */
  administrationReputationHit: 3,
  /**
   * How much a newly formed club's standing varies within its own division.
   *
   * Small on purpose: the rung is the anchor, and the roll exists only so two
   * of the county's new clubs are not the same club. It is then clamped to the
   * division's own band, so a replacement can arrive no higher or lower than
   * the rung it has joined.
   */
  replacementStandingRoll: 3,
  /**
   * What it takes for the club that comes back to be the club that went.
   *
   * Deliberately about the club rather than about a die: a club with seasons
   * behind it that a crowd still turns out for is one the town brings back —
   * same name, same shirts, same derby — and a club nobody watched, or one that
   * had barely played, is simply replaced by whatever new side the town forms
   * next. No random number decides whether the county's oldest name survives.
   */
  reformation: {
    /** Seasons on record before a club has a story worth continuing. */
    minimumSeasons: 3,
    /** The crowd's floor for "still bothered": the band `support.ts` calls settled. */
    minimumConfidence: 42,
  },
  /**
   * The committee's appeal.
   *
   * Bounded at both ends, because an appeal has to be a chance and not a
   * bailout: at the top of the range a club the county cares about raises about
   * what a good season at the gate is worth, which clears a small debt outright
   * and does not touch a large one, and at the bottom a club nobody watches
   * raises a couple of hundred pounds. See `appealProceeds`.
   */
  appeal: {
    /** A raffle, a bucket at the gate, and not much else. */
    floor: 250,
    /** A club with a name, a crowd and a town behind it. */
    ceiling: 1400,
  },
} as const;

/** One reading of a division's standard: where its middle is, and how far it spans. */
export interface DivisionStanding {
  low: number;
  median: number;
  high: number;
}

/**
 * The standing of the division a club is entering, read from the clubs in it.
 *
 * A replacement used to be minted at whatever standing its *town* drew
 * (`reputationForTown`), which has nothing to do with the rung it was joining.
 * Measured on a generated county, the bottom division's clubs stand at 24-38
 * with a median of 33, while the town draws for those same clubs run 25-41: a
 * club folding in Division Three was routinely replaced by one of Division Two's
 * standard, and a new club could arrive *above* or *below* the rung it joined.
 * The rung that churns hardest therefore climbed, and the pyramid flattened
 * towards itself.
 *
 * So the rung is the anchor: a new club is minted at the median standing of the
 * clubs already in the division whose place it takes. The clubs' own reputations
 * are what the ladder *is* — it is built by sorting them and cutting from the
 * top — so reading the rung back off its members is the only definition of a
 * division's standard the world actually holds. `null` when the division has been
 * emptied in this pass, which is the one case with nothing to read.
 */
export function divisionStanding(
  state: GameState,
  divisionClubIds: readonly ClubId[],
): DivisionStanding | null {
  const standings = divisionClubIds
    .map((id) => state.clubs[id])
    .filter((club): club is Club => Boolean(club) && club.active)
    .map((club) => club.reputation)
    .sort((a, b) => a - b);
  if (standings.length === 0) return null;
  const middle = standings.length >> 1;
  const median =
    standings.length % 2 === 1
      ? standings[middle]!
      : Math.round((standings[middle - 1]! + standings[middle]!) / 2);
  return { low: standings[0]!, median, high: standings[standings.length - 1]! };
}

export interface ClubLifecycleContext {
  seasonId: SeasonId;
  seasonLabel: string;
  seasonStart: ISODate;
  protectedClubIds?: ClubId[];
  /**
   * The ladder the new season is about to be built from, tier 1 first.
   *
   * The fold-and-reform swap happens *here*, in the division the club is in,
   * rather than on `state.competitions`: those are last season's competition
   * records and are about to be replaced. A replacement pushed into them was
   * never seen by `buildSeasonStructure`, which is how a newly formed club
   * ended up in no division at all and with no season record to archive.
   */
  divisions: ClubId[][];
}

export interface ClubFold {
  clubId: ClubId;
  name: string;
  reason: 'administration' | 'debt';
}

export interface ClubFormation {
  clubId: ClubId;
  name: string;
  townId: string;
  /** Whether this club is the one that folded, brought back, or a new one. */
  kind: ClubHeritageKind;
}

export interface ClubLifecycleOutcome {
  events: GameEvent[];
  folded: ClubFold[];
  formed: ClubFormation[];
  inTheRed: ClubId[];
  /** Clubs whose committee asked the town for money this summer. */
  appealed: ClubId[];
}

/**
 * Whether the club that comes back in this club's place is the club itself.
 *
 * Two facts decide it, and neither of them is a roll of a die: **the club has a
 * history** — seasons actually played, which is what a name and a shirt and a
 * patch of grass are worth to the people who watched them — and **the crowd has
 * not given up**, which is the one thing a supporter base is for. A club that
 * went under in debt with its crowd still behind it comes back as itself; a club
 * nobody was watching, or one that folded in its first season or two, is a place
 * in the league that a new club fills.
 *
 * Read at the boundary, so the mood is the mood the season that ruined them
 * left, not the summer's drift back towards not minding.
 */
export function isReformation(club: Club): boolean {
  return (
    club.history.seasons.length >= CLUB_LIFECYCLE.reformation.minimumSeasons &&
    supportConfidenceOf(club) >= CLUB_LIFECYCLE.reformation.minimumConfidence
  );
}

/**
 * What one appeal raises for this club.
 *
 * Four facts the game already keeps, and no dice: what the county thinks of the
 * club (`reputation`), whether its own crowd still turns out
 * (`supporters.confidence`), how big a place it plays in, and how many seasons it
 * has behind it — nobody puts money in a bucket for a club nobody has heard of.
 * The result is clamped, and the clamp is the whole design: the best-organised
 * appeal in the county raises a bit over a season's gate money, which is enough
 * to matter and not enough to make a habit of.
 */
export function appealProceeds(state: GameState, club: Club): number {
  const town = state.world.towns[club.townId];
  const reach = Math.max(0, Math.min(1, club.reputation / 100));
  const mood = Math.max(0, Math.min(1, supportConfidenceOf(club) / 100));
  const place = Math.max(0, Math.min(1, (town?.population ?? 2000) / 12000));
  const years = Math.max(0, Math.min(1, club.history.seasons.length / 6));
  const appetite = 0.35 * reach + 0.25 * mood + 0.2 * place + 0.2 * years;
  const { floor, ceiling } = CLUB_LIFECYCLE.appeal;
  return Math.round((floor + appetite * (ceiling - floor)) / 10) * 10;
}

/**
 * The committee asks the town to save the club.
 *
 * The money is real: a ledger line under `fundraising`, the same category the
 * manager's own quiz nights are booked under, so a club's books read the same
 * however the money arrived. Once per spell in administration — a club that has
 * already shaken the bucket this time round has to wait for the football to
 * change before it can ask again.
 */
function raiseAppeal(
  state: GameState,
  club: Club,
  context: ClubLifecycleContext,
  outcome: ClubLifecycleOutcome,
): void {
  if (club.finances.appealedOn) return;
  const raised = appealProceeds(state, club);
  club.finances.appealedOn = state.date;
  addLedgerEntry(state, club.id, {
    date: state.date,
    description: 'Appeal to save the club',
    category: 'fundraising',
    amount: raised,
  });
  club.history.notableEvents.unshift({
    date: context.seasonStart,
    seasonLabel: context.seasonLabel,
    description: `The committee's appeal raised £${raised}.`,
    importance: 2,
  });
  outcome.appealed.push(club.id);

  const balance = club.finances.balance;
  outcome.events.push(
    worldNews(
      state,
      `${club.identity.name} raise £${raised} to stay alive`,
      balance >= 0
        ? `Faced with folding, ${club.identity.name} went to the town and came back with £${raised} — enough to clear the debt. The club is out of the red, and the committee will not be able to ask twice.`
        : `Faced with folding, ${club.identity.name} went to the town and came back with £${raised}. It is not enough on its own: the club is still £${Math.abs(Math.round(balance))} in the red, and it is the only appeal the committee can make until the books are straight.`,
      [club.id],
    ),
  );
}

export function reviewClubFinances(state: GameState, context: ClubLifecycleContext): ClubLifecycleOutcome {
  const outcome: ClubLifecycleOutcome = { events: [], folded: [], formed: [], inTheRed: [], appealed: [] };
  const protectedIds = new Set<ClubId>(context.protectedClubIds ?? []);

  // Every division, not just the top one: a club in the bottom tier that cannot
  // pay its way is exactly the club the cycle exists for, and reading only the
  // first competition meant the rest of the pyramid could never fold.
  for (const divisionClubIds of context.divisions) {
    for (const clubId of [...divisionClubIds]) {
      const club = state.clubs[clubId];
      if (!club || !club.active) continue;

      // A debt this deep is not a bad season: it is a club that cannot pay its
      // way whatever the committee does, and it folds even where the ordinary
      // cycle is held off — see the `protectedIds` branch below.
      const terminal = club.finances.balance < CLUB_LIFECYCLE.terminalDebt;

      if (protectedIds.has(clubId) && !terminal) {
        // The player's own club is held out of the ordinary cycle, the way his
        // manager is: a club folding is a career-ending event and belongs with
        // its own decision. He is not without a way out of trouble either — he
        // has a treasurer, a fundraising screen and a committee that judges him
        // — which is the difference between him and a club nobody manages.
        club.finances.administrationSeasons = 0;
        continue;
      }

      if (club.finances.balance >= 0) {
        if ((club.finances.administrationSeasons ?? 0) > 0) {
          outcome.events.push(
            worldNews(
              state,
              `${club.identity.name} are solvent again`,
              `${club.identity.name} have cleared their debts and come out of the red.`,
              [club.id],
            ),
          );
        }
        club.finances.administrationSeasons = 0;
        // Out of the red, and the appeal that helped is spent with it: a club
        // that falls again has to earn a second one by getting straight first.
        club.finances.appealedOn = null;
        continue;
      }

      const entering = (club.finances.administrationSeasons ?? 0) <= 0;
      club.finances.administrationSeasons = (club.finances.administrationSeasons ?? 0) + 1;
      outcome.inTheRed.push(clubId);
      if (entering) {
        club.reputation = Math.max(1, club.reputation - CLUB_LIFECYCLE.administrationReputationHit);
        outcome.events.push(
          worldNews(
            state,
            `${club.identity.name} are in the red`,
            `${club.identity.name} ended the season £${Math.abs(Math.round(club.finances.balance))} in the red and go into administration. The committee has ${CLUB_LIFECYCLE.graceSeasons} seasons to turn it around before the club folds.`,
            [club.id],
          ),
        );
        // The committee's first act in administration, and the only one that can
        // change the ending: ask the town for money. Bounded, spent once, and
        // read off the club's own reach.
        raiseAppeal(state, club, context, outcome);
      }

      if (!terminal && club.finances.administrationSeasons < CLUB_LIFECYCLE.graceSeasons) {
        outcome.events.push(
          worldNews(
            state,
            `${club.identity.name} still in trouble`,
            `${club.identity.name} are still losing money — season ${club.finances.administrationSeasons} in administration. The next one could be their last.`,
            [club.id],
          ),
        );
        continue;
      }

      fold(state, club, divisionClubIds, context, outcome, terminal ? 'debt' : 'administration');
    }
  }

  return outcome;
}

/** Deactivate a club, scatter its people, and replace it in the same town. */
function fold(
  state: GameState,
  club: Club,
  divisionClubIds: ClubId[],
  context: ClubLifecycleContext,
  outcome: ClubLifecycleOutcome,
  reason: ClubFold['reason'],
): void {
  const townId = club.townId;
  const groundId = club.groundId;
  const name = club.identity.name;
  const seasons = club.history.seasons.length;
  // Read before the club is taken apart, because it is a fact about the club
  // that is going: how long it had been here, and whether anyone was watching.
  const kind: ClubHeritageKind = isReformation(club) ? 'reformed' : 'successor';

  // Out of the division and off the active list. The record stays as archive.
  const index = divisionClubIds.indexOf(club.id);
  if (index >= 0) divisionClubIds.splice(index, 1);
  club.active = false;

  // The squad and the committee go with it: a club that folds does not keep a
  // dressing room. Removing them keeps the world's population steady, because
  // the replacement club brings a new squad with it.
  for (const id of [...club.squadIds]) {
    delete state.people[id];
    removePersonRelationships(state, id);
    removePersonFromCommunication(state, id);
  }
  club.squadIds = [];
  for (const person of Object.values(state.people)) {
    if (!isOfficial(person) || person.clubId !== club.id) continue;
    // The player is not deleted by a club folding under him: he is the career,
    // and the season boundary hands him to the job market while his own record
    // keeps the club. His post is emptied here and nothing else of him is
    // touched, so no fold can ever take the manager out of the world.
    if (person.id === MANAGER_PERSON_ID) {
      person.clubId = null;
      person.roles = [];
      continue;
    }
    delete state.people[person.id];
    removePersonRelationships(state, person.id);
    removePersonFromCommunication(state, person.id);
  }
  club.managerId = null;
  club.chairmanId = null;

  // The ground falls vacant, ready for whoever plays there next.
  const ground = state.world.grounds[groundId];
  if (ground && ground.tenantClubId === club.id) ground.tenantClubId = null;

  outcome.folded.push({ clubId: club.id, name, reason });

  const formed = formReplacement(state, townId, groundId, context, divisionClubIds, club, kind);
  // The county's relationships come off the dead id, and onto the club that has
  // taken its place where the club has come back.
  moveRivalries(state, club.id, kind === 'reformed' ? formed.clubId : null);
  outcome.formed.push(formed);

  club.history.notableEvents.unshift({
    date: context.seasonStart,
    seasonLabel: context.seasonLabel,
    description:
      kind === 'reformed'
        ? `The club folded after running out of money, and was re-formed the same summer as ${formed.name}.`
        : `The club folded after running out of money.`,
    importance: 3,
  });

  outcome.events.push(
    worldNews(
      state,
      `${name} have folded`,
      reason === 'debt'
        ? `${name} could not pay their way and have folded with debts of £${Math.abs(Math.round(club.finances.balance))}${seasons > 0 ? `, after ${seasons} season${seasons === 1 ? '' : 's'}` : ''}.`
        : `${name} have folded after ${CLUB_LIFECYCLE.graceSeasons} seasons in administration${seasons > 0 ? `, ${seasons} of them played` : ''}.`,
      [club.id, formed.clubId],
    ),
  );
  outcome.events.push(
    worldNews(
      state,
      kind === 'reformed' ? `${formed.name} are re-formed` : `${formed.name} are formed`,
      kind === 'reformed'
        ? `${name} are back. A reformed club has taken the name, the ground and the place in the league, and the crowd that watched the old one will find it where it always was. None of the debt came with it, and neither did the men who ran it.`
        : `A new club, ${formed.name}, has been formed in ${state.world.towns[townId]?.name ?? 'the area'} and will take ${name}'s place in the league.`,
      [formed.clubId, club.id],
    ),
  );
}

/**
 * Move the county's relationships off a club that has gone.
 *
 * Nothing used to do this, and the world was left holding it: every other club's
 * record kept its entry keyed on the dead id, so a club's book could name a
 * rival that no longer played and the cooling rule went on tending a
 * relationship with nobody.
 *
 * Where the same club comes back, the relationship is not deleted but *moved*,
 * because a derby is between two towns and two crowds and not between two
 * registrations: it survives the club dying and picks up where it left off.
 * Where the club does not come back, `to` is null and it goes with it.
 *
 * The folded club keeps its own record of who it cared about — that is part of
 * what it was, and the archive is allowed to hold it.
 */
export function moveRivalries(state: GameState, from: ClubId, to: ClubId | null): void {
  for (const club of Object.values(state.clubs)) {
    if (club.id === from) continue;
    const entry = club.rivalries?.[from];
    if (!entry) continue;
    delete club.rivalries[from];
    if (to === null) continue;
    const existing = club.rivalries[to];
    club.rivalries[to] = existing ? mergeRivalries(entry, existing) : entry;
  }

  if (to === null) return;
  const predecessor = state.clubs[from];
  const successor = state.clubs[to];
  if (!predecessor || !successor) return;
  successor.rivalries = Object.fromEntries(
    Object.entries(predecessor.rivalries ?? {}).map(([otherId, entry]) => [otherId, { ...entry }]),
  );
}

/**
 * Two records of the same relationship, as one.
 *
 * Both the old id and the new one can only be in a club's book at once if the
 * county has been through this before — a club reformed twice — in which case
 * what the two sides remember of the same town belongs in one entry rather than
 * one of them being dropped.
 */
function mergeRivalries(a: ClubRivalry, b: ClubRivalry): ClubRivalry {
  const derby = a.kind === 'derby' || b.kind === 'derby';
  const historic = a.kind === 'historic' || b.kind === 'historic';
  const dates = [a.lastMetOn ?? '', b.lastMetOn ?? ''].filter(Boolean).sort();
  return {
    intensity: Math.max(a.intensity, b.intensity),
    note: a.note,
    baseline: Math.max(rivalryBaseline(a), rivalryBaseline(b)),
    kind: derby ? 'derby' : historic ? 'historic' : (b.kind ?? a.kind),
    since: [a.since, b.since].filter((date): date is string => typeof date === 'string').sort()[0],
    lastMetOn: dates[dates.length - 1] ?? null,
    meetings: (a.meetings ?? 0) + (b.meetings ?? 0),
    heat: Math.max(a.heat ?? 0, b.heat ?? 0),
  };
}

/** A new club in the same town — the other half of the cycle, so the league holds its size. */
function formReplacement(
  state: GameState,
  townId: string,
  groundId: GroundId,
  context: ClubLifecycleContext,
  divisionClubIds: ClubId[],
  replaced: Club,
  kind: ClubHeritageKind,
): ClubFormation {
  const town = state.world.towns[townId]!;
  // The stream and the id are keyed on the club being replaced, not on the
  // town: a town can hold more than one club, and two of them folding in the
  // same summer used to mint the *same* replacement twice — one id pushed into
  // the division twice, one club scheduled in two fixtures on the same day,
  // and both replacements sharing a name because they drew from one stream.
  const rng = stream(state.seed, 'club-formation', context.seasonId, replaced.id);
  const clubId: ClubId = `club_new_${context.seasonId}_${replaced.id}`;
  const reformed = kind === 'reformed';
  const foundedYear = yearOf(context.seasonStart);

  // A reformation keeps the club's identity, so there is no name to draw: the
  // name is the whole point of it, and so are the shirts. A successor is named
  // like any other new club — after the town it plays in.
  const usedNames = new Set(Object.values(state.clubs).map((existing) => existing.identity.name));
  const usedNicknames = new Set(Object.values(state.clubs).map((existing) => existing.identity.nickname));
  const businesses = Object.values(state.world.businesses).filter((business) => business.townId === townId);
  const identity = reformed
    ? { ...replaced.identity }
    : buildClubName(rng, town, businesses, usedNames, usedNicknames, new Set<string>(), foundedYear)
        .identity;

  // The football follows the rung, the place follows the town: a county's new
  // club plays at the standard of the division it is stepping into, and the town
  // draw is the fallback for a division with nobody left in it to read.
  //
  // A re-formation is the exception, and deliberately so: the club that came back
  // is the club that went — the same name, the same crowd, the same pitch — so it
  // plays at the standard it was already playing at. Re-rolling a re-formation at
  // the middle of its rung would make the county quietly write off the standing
  // of every club that ever had a bad decade, and a rung that churns would be
  // dragged towards its own middle: measured over ten seasons, the top two rungs
  // of one seeded county converged to within the separation the pyramid is meant
  // to hold. A club that has come back is evidence about the rung it plays in, so
  // it keeps its own standing; a club that has simply been replaced takes the
  // rung's.
  const rung = divisionStanding(state, divisionClubIds);
  const reputation = reformed
    ? replaced.reputation
    : rung
      ? Math.max(
          rung.low,
          Math.min(
            rung.high,
            Math.round(rung.median + rng.gaussian(0, CLUB_LIFECYCLE.replacementStandingRoll)),
          ),
        )
      : reputationForTown(rng, town);
  const ground = state.world.grounds[groundId];
  if (ground) {
    ground.tenantClubId = clubId;
    if (!ground.sharedWith.includes(clubId)) ground.sharedWith.push(clubId);
  }

  const squad = generateSquad({
    rng,
    clubId,
    townId,
    homeGroundId: groundId,
    quality: clubQualityFromReputation(rng, reputation),
    seasonStart: context.seasonStart,
    idSeedPrefix: clubId,
  });
  for (const player of squad) state.people[player.id] = player;

  const chairman = generateChairman(rng, townId, 0);
  // Keyed on the club being replaced, exactly as the club's own id is, and for
  // exactly the same reason: two clubs in one town can fold in the same summer,
  // and a chairman id keyed on the town mints the same man twice. The second
  // write wins, both clubs then name one person, and the day either club folds
  // again the fold deletes the officials it owns and leaves the other club
  // pointing at a chairman who has gone (found by the fifteen-season soak:
  // `club-official-exists`).
  chairman.id = `chm_${context.seasonId}_${replaced.id}`;
  chairman.clubId = clubId;
  chairman.roles = [{ clubId, role: 'chairman', since: context.seasonStart }];
  chairman.notes = [
    reformed
      ? `Re-formed the club ahead of ${context.seasonLabel}, after the old one folded.`
      : `Helped found the club ahead of ${context.seasonLabel}.`,
  ];
  state.people[chairman.id] = chairman;

  const staff = generateClubStaff({
    seed: state.seed,
    clubId,
    townId,
    reputation,
    structure: 'community',
    seasonStart: context.seasonStart,
    squad,
    people: state.people,
    managerId: null,
    chairmanId: chairman.id,
  });

  // Neither club inherits a trophy: a re-formed club has won nothing *yet*, and
  // `emptyHistory` gives an established club a potted honour to have won, which
  // a club founded this summer cannot have. A successor keeps the founding line
  // `emptyHistory` writes, because for a club that has just been made it is
  // simply true; a re-formation replaces it, because "founded in 2027" is the
  // one thing a club founded in 1921 is not — and the year the club was really
  // founded travels in `heritage`, with the club it came from.
  const base = emptyHistory(rng, reformed ? replaced.history.founded : foundedYear);
  const heritageLine = {
    date: context.seasonStart,
    seasonLabel: context.seasonLabel,
    description: `Re-formed as the successor to ${replaced.identity.name}, which folded after ${replaced.history.seasons.length} season${replaced.history.seasons.length === 1 ? '' : 's'}.`,
    importance: 2 as const,
  };
  const history = reformed
    ? { ...base, honours: [], notableEvents: [heritageLine] }
    : { ...base, honours: [], notableEvents: [...base.notableEvents, heritageLine] };

  const club: Club = {
    id: clubId,
    identity,
    townId,
    groundId,
    // A reformed club comes back as the kind of club it was — the same people,
    // the same way of running it — where a new club starts as a community club.
    structure: reformed ? replaced.structure : 'community',
    reputation,
    squadIds: squad.map((player) => player.id),
    chairmanId: chairman.id,
    managerId: null, // the managers' market fills it, the same as any vacancy
    staff,
    sponsorIds: [],
    // A club formed this summer plays like the club its standing says it is,
    // from its own stream: the men who founded it have their own idea of
    // football, and it must not be drawn from the stream the finances are.
    tactics: styleTactics(new Rng(`${state.seed}::tactics::${clubId}`), reputation),
    // New finances, and no debt: this is the other half of the cycle. Nothing
    // the predecessor owed comes across, which is what makes a reformation a way
    // out rather than a way of carrying the debt into a new name.
    finances: buildFinances(rng, town, reputation),
    history,
    active: true,
    // The link back. The club it names is still in the world, inactive, with its
    // own name and its own record, and nothing about it has been rewritten.
    heritage: {
      predecessorId: replaced.id,
      predecessorName: replaced.identity.name,
      predecessorFounded: replaced.history.founded,
      kind,
      since: context.seasonStart,
      inherited: reformed
        ? ['the name', 'the shirts', 'the ground', 'the crowd', 'the rivalries']
        : ['the ground'],
    },
    // A club founded this summer is nothing to anybody yet. A re-formation is
    // the exception, because the same crowd was watching the same pitch a season
    // ago: the county's relationships are moved onto it by `moveRivalries`, and
    // the gate it draws is the gate its predecessor drew.
    rivalries: {},
    supporters: reformed
      ? { ...replaced.supporters, recent: [...(replaced.supporters?.recent ?? [])] }
      : defaultSupporters(context.seasonStart),
  };
  state.clubs[clubId] = club;
  divisionClubIds.push(clubId);
  return { clubId, name: club.identity.name, townId, kind };
}

function worldNews(state: GameState, headline: string, body: string, clubIds: ClubId[]): GameEvent {
  return createEvent(state, { type: 'world', importance: 3, clubIds, data: { headline, body } });
}
