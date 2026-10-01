import type { GameState } from '@/domain/game';
import type { PersonId } from '@/domain/ids';
import type { GameEvent } from '@/domain/news';
import { isPlayer, personDisplayName } from '@/domain/person';
import { formatShortDate } from '../calendar';
import { createEvent } from '../news';
import {
  applyRelationshipEvent,
  getRelationship,
  personName,
  recordInteraction,
  relationshipStore,
  relationshipViewsFor,
  upsertRelationship,
} from '../relationships';
import { linkNewTeammate } from '../generation/relationshipGenerator';
import { stream } from '../rng';
import { candidateInterest, resolveInvitation } from './interest';
import { candidateOf, recordCandidateHistory, setCandidateStatus } from './store';

/**
 * Asking the question, and signing the player.
 *
 * Two things are happening at once here. One is a squad list gaining a name.
 * The other is a social act: a club has taken a player off another club, a mate
 * has made good on his word, and somebody's dressing room is a man lighter.
 * Both are simulated.
 */

export interface ApproachResult {
  ok: boolean;
  interested: boolean;
  message: string;
  events: GameEvent[];
}

/** Ask him — or ask around about him. The answer is a sentence, not a score. */
export function approachCandidate(state: GameState, personId: PersonId): ApproachResult {
  const club = state.clubs[state.userClubId];
  const person = state.people[personId];
  const record = candidateOf(state, personId);
  if (!club || !isPlayer(person) || !record) {
    return { ok: false, interested: false, message: 'Nobody to ask about.', events: [] };
  }
  if (record.status === 'joined') {
    return { ok: true, interested: true, message: `${person.firstName} is already yours.`, events: [] };
  }

  const rng = stream(state.seed, 'recruitment', 'approach', state.date, personId);
  const { accepted, response, score } = resolveInvitation(state, personId, club.id, rng);
  const events: GameEvent[] = [];

  record.interestHints.push(response);

  if (!accepted) {
    setCandidateStatus(state, record, 'declined', response);
    recordCandidateHistory(state, record, `You asked him about joining: “${response}”`, state.date);
    events.push(
      createEvent(state, {
        type: 'recruitment',
        importance: 2,
        clubIds: [club.id],
        personIds: [personId],
        data: {
          headline: `${person.firstName} ${person.surname} turns you down`,
          body: `You put it to ${personDisplayName(person)} about joining ${club.identity.name}. He said: “${response}”`,
        },
      }),
    );
    return { ok: true, interested: false, message: `${personDisplayName(person)}: “${response}”`, events };
  }

  setCandidateStatus(state, record, 'approached');
  recordCandidateHistory(state, record, `You asked him about joining: “${response}”`, state.date);

  // Word gets round. An approach to a player who is settled somewhere else does
  // not always stay quiet, and his manager will have something to say about it.
  if (person.clubId && rng.chance(0.4)) {
    const previousClub = state.clubs[person.clubId];
    const previousManagerId = previousClub?.managerId ?? null;
    if (previousClub && previousManagerId && club.managerId && previousManagerId !== club.managerId) {
      const managerId = club.managerId;
      if (!getRelationship(state, previousManagerId, managerId)) {
        upsertRelationship(state, {
          aId: previousManagerId,
          bId: managerId,
          origin: 'manager-manager',
          context: previousClub.identity.shortName,
          provenance: 'known',
        });
      }
      recordInteraction(state, {
        aId: previousManagerId,
        bId: managerId,
        aToB: { tension: 12, trust: -6, friendship: -3 },
        bToA: { tension: 4 },
        description: `Tried to take ${person.firstName} ${person.surname} off him`,
        tone: 'negative',
        date: state.date,
      });
      events.push(
        createEvent(state, {
          type: 'recruitment',
          importance: 2,
          clubIds: [club.id, previousClub.id],
          personIds: [personId, previousManagerId],
          data: {
            headline: `${previousClub.identity.shortName} hear about your interest in ${person.surname}`,
            body: `${personName(state, previousManagerId)} at ${previousClub.identity.name} has been told you have been asking about ${personDisplayName(person)}. He is not pleased about it.`,
          },
        }),
      );
    }
  }

  return {
    ok: true,
    interested: true,
    message: `${personDisplayName(person)}: “${response}” ${
      score >= 72 ? 'That sounds like a yes already.' : ''
    }`.trim(),
    events,
  };
}

export interface SigningResult {
  ok: boolean;
  signed: boolean;
  message: string;
  events: GameEvent[];
}

/**
 * Invite him to join and register him.
 *
 * Registering a player is deliberately not a transfer: there is no fee, no
 * agent and no window. What there is instead is a decision by the player, a
 * sentence of explanation either way, and consequences for the club he leaves.
 */
export function signCandidate(state: GameState, personId: PersonId): SigningResult {
  const club = state.clubs[state.userClubId];
  const person = state.people[personId];
  const record = candidateOf(state, personId);
  if (!club || !isPlayer(person) || !record) {
    return { ok: false, signed: false, message: 'Nobody to sign.', events: [] };
  }
  if (person.clubId === club.id) {
    return { ok: false, signed: false, message: `${person.firstName} already plays for you.`, events: [] };
  }

  const rng = stream(state.seed, 'recruitment', 'sign', state.date, personId);
  // He has already told you he fancies it, so it is easier the second time.
  const alreadyKeen = record.status === 'approached';
  const { accepted, response } = resolveInvitation(state, personId, club.id, rng, {
    threshold: alreadyKeen ? 42 : 55,
  });
  const events: GameEvent[] = [];

  if (!accepted) {
    setCandidateStatus(state, record, 'declined', response);
    recordCandidateHistory(state, record, `Turned the club down: “${response}”`, state.date);
    events.push(
      createEvent(state, {
        type: 'recruitment',
        importance: 2,
        clubIds: [club.id],
        personIds: [personId],
        data: {
          headline: `${person.surname} turns ${club.identity.shortName} down`,
          body: `${personDisplayName(person)} has decided against it: “${response}”`,
        },
      }),
    );
    return { ok: true, signed: false, message: `${personDisplayName(person)} said no: “${response}”`, events };
  }

  const previousClubId = person.clubId;
  const previousClub = previousClubId ? state.clubs[previousClubId] : undefined;
  const previousManagerId = previousClub?.managerId ?? null;

  // Leaving a club is a social act too.
  const teammates = relationshipViewsFor(state, person.id)
    .filter((view) => {
      const other = state.people[view.otherId];
      return isPlayer(other) && other.clubId === previousClubId;
    })
    .sort((a, b) => a.relationship.strength - b.relationship.strength);
  for (const view of teammates.slice(0, 4)) {
    applyRelationshipEvent(state, {
      type: 'left-club',
      aId: person.id,
      bId: view.otherId,
      intensity: 1,
      date: state.date,
      clubId: previousClubId ?? club.id,
    });
  }
  if (previousManagerId) {
    applyRelationshipEvent(state, {
      type: 'left-club',
      aId: person.id,
      bId: previousManagerId,
      intensity: 1.2,
      date: state.date,
      clubId: previousClubId ?? club.id,
      detail: 'left for another club',
    });
  }

  // And so is arriving at one.
  if (previousClub && previousClubId) {
    previousClub.squadIds = previousClub.squadIds.filter((id) => id !== person.id);
    const existing = previousClub.rivalries[club.id];
    const intensity = Math.max(6, Math.min(95, (existing?.intensity ?? 12) + rng.int(6, 14)));
    previousClub.rivalries[club.id] = {
      intensity,
      note: `${club.identity.shortName} took ${person.firstName} ${person.surname} off them.`,
    };
    const reverse = club.rivalries[previousClubId];
    club.rivalries[previousClubId] = {
      intensity: Math.max(intensity, reverse?.intensity ?? 0),
      note: reverse?.note ?? `They are still unhappy about ${person.firstName} ${person.surname}.`,
    };
  }

  person.clubId = club.id;
  person.registered = true;
  person.roles = [{ clubId: club.id, role: 'player', since: state.date }];
  person.joinedClubOn = state.date;
  if (!club.squadIds.includes(person.id)) club.squadIds.push(person.id);
  person.notes.push(`Joined ${club.identity.name} on ${formatShortDate(state.date)}.`);

  club.history.notableEvents.unshift({
    date: state.date,
    seasonLabel: state.season.label,
    description: previousClub
      ? `Signed ${person.firstName} ${person.surname} from ${previousClub.identity.name}.`
      : `Signed ${person.firstName} ${person.surname}, who was not playing anywhere.`,
    importance: 1,
  });
  if (club.history.notableEvents.length > 40) club.history.notableEvents.length = 40;

  const store = relationshipStore(state);
  const managerId = club.managerId;
  if (managerId) {
    upsertRelationship(state, {
      aId: managerId,
      bId: person.id,
      origin: 'player-manager',
      context: `Manager at ${club.identity.shortName}`,
      aToB: { respect: 52, trust: 50, loyalty: 48 },
      bToA: { respect: 50, trust: 50, loyalty: 46, friendship: 46 },
    });
    applyRelationshipEvent(state, {
      type: 'joined-club',
      aId: person.id,
      bId: managerId,
      intensity: 0.9,
      date: state.date,
      clubId: club.id,
      detail: 'after you brought him in',
    });
  }

  const teammatesAtNewClub = club.squadIds.filter((id) => id !== person.id);
  linkNewTeammate(store, state.seed, club, person.id, teammatesAtNewClub, state.date);
  for (const view of relationshipViewsFor(state, person.id).slice(0, 2)) {
    applyRelationshipEvent(state, {
      type: 'joined-club',
      aId: person.id,
      bId: view.otherId,
      intensity: 0.6,
      date: state.date,
      clubId: club.id,
    });
  }

  // A recommendation that comes off binds the recommender to the player and to you.
  if (record.sourcePersonId) {
    applyRelationshipEvent(state, {
      type: 'recommendation',
      aId: record.sourcePersonId,
      bId: person.id,
      intensity: 1,
      date: state.date,
      clubId: club.id,
      detail: 'and it came off',
    });
    if (managerId) {
      const withManager = getRelationship(state, record.sourcePersonId, managerId);
      if (withManager) {
        recordInteraction(state, {
          aId: record.sourcePersonId,
          bId: managerId,
          aToB: { trust: 4, respect: 3, loyalty: 3 },
          bToA: { trust: 6, respect: 5 },
          description: `Put ${person.firstName} ${person.surname} forward, and you signed him`,
          tone: 'positive',
          date: state.date,
        });
      }
    }
  }

  setCandidateStatus(state, record, 'joined', `${club.identity.name}`);
  recordCandidateHistory(
    state,
    record,
    `Joined ${club.identity.name} on ${formatShortDate(state.date)}.`,
    state.date,
  );

  events.push(
    createEvent(state, {
      type: 'player-signed',
      importance: 3,
      clubIds: [club.id, ...(previousClubId ? [previousClubId] : [])],
      personIds: [person.id, ...(record.sourcePersonId ? [record.sourcePersonId] : [])],
      data: {
        headline: `${person.firstName} ${person.surname} signs for ${club.identity.name}`,
        body: previousClub
          ? `${personDisplayName(person)} (${person.age}, ${person.preferredPosition}) joins from ${previousClub.identity.name}${
              record.sourcePersonId ? ` after a word from ${personName(state, record.sourcePersonId)}` : ''
            }. He is registered and available for selection.`
          : `${personDisplayName(person)} (${person.age}, ${person.preferredPosition}) joins the club, having not been playing anywhere. He is registered and available for selection.`,
      },
    }),
  );

  return {
    ok: true,
    signed: true,
    message: `${personDisplayName(person)} has signed. ${club.squadIds.length} registered players.`,
    events,
  };
}

/** Decide against somebody, with a note of why for the record. */
export function passOnCandidate(state: GameState, personId: PersonId, reason?: string): void {
  const record = candidateOf(state, personId);
  const person = state.people[personId];
  if (!record || !person) return;
  const note = reason ?? 'You decided he was not what the squad needs.';
  setCandidateStatus(state, record, 'passed', note);
  recordCandidateHistory(state, record, note, state.date);
}

/** A quick read on whether he would come, for the UI: never the raw number. */
export function joiningProspect(state: GameState, personId: PersonId): string {
  const club = state.clubs[state.userClubId];
  if (!club) return '';
  const { score, reasons } = candidateInterest(state, personId, club.id);
  const blocker = reasons.find((reason) => reason.weight < 0);
  if (score >= 70) return 'Would take very little persuading.';
  if (score >= 56) return 'Worth asking properly.';
  if (score >= 44) return blocker ? `Could go either way — ${blocker.text.toLowerCase()}` : 'Could go either way.';
  return blocker ? `Unlikely — ${blocker.text.toLowerCase()}` : 'Unlikely.';
}
