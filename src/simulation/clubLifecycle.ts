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
import { defaultTactics } from '@/domain/tactics';
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
} as const;

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

  const reputation = reputationForTown(rng, town);
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
  chairman.id = `chm_${context.seasonId}_${townId}`;
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
    tactics: defaultTactics('4-4-2'),
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
