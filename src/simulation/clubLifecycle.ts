/**
 * A club has to be able to die.
 *
 * Money in this world had no failure state: every side's balance only ever
 * climbed, so a club could be run into the ground for a decade and nothing
 * happened. Real local football is full of clubs that went under — a sponsor
 * walked, the pitch hire went up, the committee ran out of people — and of new
 * clubs that appear in the same town a season or two later, often on the same
 * pitch, with a new name and a new committee.
 *
 * This module gives that cycle its first turn at the season boundary: a club
 * that ends the season in the red enters administration, and one that cannot get
 * out of it folds. A folded club's place is immediately taken by a newly formed
 * club in the same town, so the division never shrinks and the world keeps its
 * size however long the career runs.
 */

import type { Club } from '@/domain/club';
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
import { createEvent } from './news';
import { removePersonFromCommunication } from './communication/store';
import { removePersonRelationships } from './relationships';
import { stream } from './rng';
import { generateClubStaff } from './staff';

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
 * Measured on a generated county, the bottom division's clubs stand at 24–38
 * with a median of 33, while the town draws for those same clubs run 25–41: a
 * club folding in Division Three was routinely replaced by one of Division Two's
 * standard, and a new club could arrive *above* or *below* the rung it joined.
 * The rung that churns hardest therefore climbed — over fifteen seasons of the
 * soak, division 3 rose 3–6% while division 1 was flat, and the pyramid
 * flattened towards itself.
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
}

export interface ClubLifecycleOutcome {
  events: GameEvent[];
  folded: ClubFold[];
  formed: ClubFormation[];
  inTheRed: ClubId[];
}

export function reviewClubFinances(state: GameState, context: ClubLifecycleContext): ClubLifecycleOutcome {
  const outcome: ClubLifecycleOutcome = { events: [], folded: [], formed: [], inTheRed: [] };
  const protectedIds = new Set<ClubId>(context.protectedClubIds ?? []);

  // Every division, not just the top one: a club in the bottom tier that cannot
  // pay its way is exactly the club the cycle exists for, and reading only the
  // first competition meant the rest of the pyramid could never fold.
  for (const divisionClubIds of context.divisions) {
    for (const clubId of [...divisionClubIds]) {
      const club = state.clubs[clubId];
      if (!club || !club.active) continue;
      if (protectedIds.has(clubId)) {
        // The player's own club is held out of this for now, the way his manager
        // is: a club folding is a career-ending event and belongs with its own
        // decision.
        club.finances.administrationSeasons = 0;
        continue;
      }

      if (club.finances.balance >= 0) {
        if ((club.finances.administrationSeasons ?? 0) > 0) {
          outcome.events.push(
            worldNews(state, `${club.identity.name} are solvent again`, `${club.identity.name} have cleared their debts and come out of the red.`),
          );
        }
        club.finances.administrationSeasons = 0;
        continue;
      }

      club.finances.administrationSeasons = (club.finances.administrationSeasons ?? 0) + 1;
      outcome.inTheRed.push(clubId);
      if (club.finances.administrationSeasons <= 1) {
        club.reputation = Math.max(1, club.reputation - CLUB_LIFECYCLE.administrationReputationHit);
        outcome.events.push(
          worldNews(
            state,
            `${club.identity.name} are in the red`,
            `${club.identity.name} ended the season £${Math.abs(Math.round(club.finances.balance))} in the red and go into administration. The committee has ${CLUB_LIFECYCLE.graceSeasons} seasons to turn it around before the club folds.`,
          ),
        );
      }

      const terminal = club.finances.balance < CLUB_LIFECYCLE.terminalDebt;
      if (!terminal && club.finances.administrationSeasons < CLUB_LIFECYCLE.graceSeasons) {
        outcome.events.push(
          worldNews(
            state,
            `${club.identity.name} still in trouble`,
            `${club.identity.name} are still losing money — a second season in administration. The next one could be their last.`,
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

  // Out of the division and off the active list. The record stays as archive.
  const index = divisionClubIds.indexOf(club.id);
  if (index >= 0) divisionClubIds.splice(index, 1);
  club.active = false;
  club.history.notableEvents.unshift({
    date: context.seasonStart,
    seasonLabel: context.seasonLabel,
    description: `The club folded after running out of money.`,
    importance: 3,
  });

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
  outcome.events.push(
    worldNews(
      state,
      `${name} have folded`,
      reason === 'debt'
        ? `${name} could not pay their way and have folded with debts of £${Math.abs(Math.round(club.finances.balance))}.`
        : `${name} have folded after ${CLUB_LIFECYCLE.graceSeasons} seasons in administration.`,
    ),
  );

  const formed = formReplacement(state, townId, groundId, context, divisionClubIds, club.id);
  outcome.formed.push(formed);
  outcome.events.push(
    worldNews(
      state,
      `${formed.name} are formed`,
      `A new club, ${formed.name}, has been formed in ${state.world.towns[townId]?.name ?? 'the area'} and will take ${name}'s place in the league.`,
    ),
  );
}

/** A new club in the same town — the other half of the cycle, so the league holds its size. */
function formReplacement(
  state: GameState,
  townId: string,
  groundId: GroundId,
  context: ClubLifecycleContext,
  divisionClubIds: ClubId[],
  replacedClubId: ClubId,
): ClubFormation {
  const town = state.world.towns[townId]!;
  // The stream and the id are keyed on the club being replaced, not on the
  // town: a town can hold more than one club, and two of them folding in the
  // same summer used to mint the *same* replacement twice — one id pushed into
  // the division twice, one club scheduled in two fixtures on the same day,
  // and both replacements sharing a name because they drew from one stream.
  const rng = stream(state.seed, 'club-formation', context.seasonId, replacedClubId);
  const clubId: ClubId = `club_new_${context.seasonId}_${replacedClubId}`;

  const usedNames = new Set(Object.values(state.clubs).map((existing) => existing.identity.name));
  const usedNicknames = new Set(Object.values(state.clubs).map((existing) => existing.identity.nickname));
  const businesses = Object.values(state.world.businesses).filter((business) => business.townId === townId);
  const { identity } = buildClubName(
    rng,
    town,
    businesses,
    usedNames,
    usedNicknames,
    new Set<string>(),
    yearOf(context.seasonStart),
  );

  // The football follows the rung, the place follows the town: a county's new
  // club is named after where it is, plays on the pitch it can get, and plays at
  // the standard of the division it is stepping into. The town draw is kept only
  // as the fallback for a division with nobody left in it to read.
  const rung = divisionStanding(state, divisionClubIds);
  const reputation = rung
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
  chairman.id = `chm_${context.seasonId}_${replacedClubId}`;
  chairman.clubId = clubId;
  chairman.roles = [{ clubId, role: 'chairman', since: context.seasonStart }];
  chairman.notes = [`Helped found the club ahead of ${context.seasonLabel}.`];
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

  const club: Club = {
    id: clubId,
    identity,
    townId,
    groundId,
    structure: 'community',
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
    finances: buildFinances(rng, town, reputation),
    // A club founded this summer has founded nothing yet: `emptyHistory` gives an
    // established club a potted honour or two, which a brand-new one cannot have.
    history: { ...emptyHistory(rng, yearOf(context.seasonStart)), honours: [] },
    active: true,
    rivalries: {},
  };
  state.clubs[clubId] = club;
  divisionClubIds.push(clubId);
  return { clubId, name: club.identity.name, townId };
}

function worldNews(state: GameState, headline: string, body: string): GameEvent {
  return createEvent(state, { type: 'world', importance: 3, data: { headline, body } });
}
