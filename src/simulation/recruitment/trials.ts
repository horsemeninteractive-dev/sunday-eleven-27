import type { GameState } from '@/domain/game';
import type { PersonId } from '@/domain/ids';
import type { GameEvent } from '@/domain/news';
import { isPlayer, personDisplayName } from '@/domain/person';
import { formatShortDate } from '../calendar';
import { applyRelationshipEvent, getRelationship, upsertRelationship } from '../relationships';
import { createEvent } from '../news';
import { stream } from '../rng';
import { scheduleTrial } from '../schedule';
import { knowledgeFromTrial, meanAttributeOf } from './knowledge';
import { candidateInterest } from './interest';
import { squadQuality } from './needs';
import { candidateOf, recordCandidateHistory, recruitmentStore, setCandidateStatus } from './store';

/**
 * Trials.
 *
 * A trial is a real look at somebody, taken on a Thursday evening with half the
 * squad away. It tells you more than a rumour and less than the truth, and the
 * impression a player makes is not the same as his ability: some lads look
 * ordinary and turn out to be exactly what you needed.
 */

export interface TrialInviteResult {
  ok: boolean;
  message: string;
  events: GameEvent[];
}

export function inviteToTrial(state: GameState, personId: PersonId): TrialInviteResult {
  const club = state.clubs[state.userClubId];
  const candidate = state.people[personId];
  const record = candidateOf(state, personId);
  if (!club || !isPlayer(candidate) || !record) {
    return { ok: false, message: 'Nobody to invite.', events: [] };
  }
  if (record.status === 'joined') {
    return { ok: false, message: `${candidate.firstName} already plays for you.`, events: [] };
  }
  if (record.status === 'invited') {
    return { ok: true, message: `${candidate.firstName} is already down for the next session.`, events: [] };
  }

  const rng = stream(state.seed, 'recruitment', 'invite', state.date, personId);
  const { score } = candidateInterest(state, personId, club.id);
  const willing = score + rng.gaussian(0, 7) >= 32;

  if (!willing) {
    recordCandidateHistory(
      state,
      record,
      `${candidate.firstName} will not even come down for a session — not interested.`,
      state.date,
    );
    return {
      ok: false,
      message: `${personDisplayName(candidate)} would not come down. He is not interested.`,
      events: [],
    };
  }

  setCandidateStatus(state, record, 'invited');
  // Book it against the calendar rather than leaving it as a promise: the next
  // session is a date, and the trial now sits on it.
  scheduleTrial(state, personId, `${personDisplayName(candidate)} is coming down for a look.`);
  recordCandidateHistory(state, record, `Invited down to a session on ${formatShortDate(state.date)}.`, state.date);
  return {
    ok: true,
    message: `${personDisplayName(candidate)} says he will come down to the next session.`,
    events: [],
  };
}

export interface TrialSessionOutcome {
  personId: PersonId;
  attended: boolean;
  summary: string;
  impression: 'impressed' | 'mixed' | 'poor' | 'no-show';
}

export interface TrialSessionResult {
  events: GameEvent[];
  outcomes: TrialSessionOutcome[];
  messages: string[];
}

/**
 * Run the session the invited players were asked to come to. People who are on
 * holiday, working or simply cannot be bothered do not turn up.
 */
export function runTrialSession(state: GameState): TrialSessionResult {
  const club = state.clubs[state.userClubId];
  const result: TrialSessionResult = { events: [], outcomes: [], messages: [] };
  if (!club) return result;

  const store = recruitmentStore(state);
  const invited = [...store.pendingTrialIds];
  if (invited.length === 0) {
    result.messages.push('Nobody is down for a session at the moment.');
    return result;
  }

  const clubQuality = squadQuality(state, club.id);
  const groundName = state.world.grounds[club.groundId]?.name ?? 'the Rec';
  const managers = club.squadIds.map((id) => state.people[id]).filter(isPlayer);
  const lines: string[] = [];

  for (const personId of invited) {
    const person = state.people[personId];
    const record = candidateOf(state, personId);
    if (!isPlayer(person) || !record) continue;

    const rng = stream(state.seed, 'recruitment', 'trial-session', state.date, personId);
    const unreliable = person.attributes.behavioural.reliability <= 8;
    const available = person.availability.status !== 'unavailable';
    const turnsUp = available && rng.chance(unreliable ? 0.62 : 0.9);

    if (!turnsUp) {
      const reason = !available
        ? `could not make it (${person.availability.note ?? 'unavailable'})`
        : 'did not turn up and did not say why';
      recordCandidateHistory(state, record, `${person.firstName} ${reason}.`, state.date);
      result.outcomes.push({ personId, attended: false, summary: `${person.firstName} ${reason}.`, impression: 'no-show' });
      lines.push(`${personDisplayName(person)} ${reason}.`);
      setCandidateStatus(state, record, 'watching');
      continue;
    }

    const read = knowledgeFromTrial(rng, {
      candidate: person,
      date: state.date,
      clubQuality,
      sessionLabel: 'A session with the squad',
    });
    record.knowledge = {
      attributes: { ...record.knowledge.attributes, ...read.knowledge.attributes },
      notes: [...new Set([...record.knowledge.notes, ...read.knowledge.notes])].slice(0, 14),
    };
    record.trials += 1;
    setCandidateStatus(state, record, 'trialled');
    recordCandidateHistory(
      state,
      record,
      `Training session with the squad at ${groundName}: ${read.summary}`,
      state.date,
    );

    // He is forming a view of you at the same time as you are forming one of him.
    if (read.impression === 'impressed') {
      record.interestHints.push('Enjoyed the session — the standard suited him.');
    } else if (read.impression === 'poor') {
      record.interestHints.push('Looked a bit overawed by it all.');
    }

    // A trial is a physical test on a real pitch, so knocks happen.
    if (rng.chance(Math.max(0.02, person.attributes.hidden.injurySusceptibility / 260))) {
      person.injury = { description: 'rolled ankle', severity: 'minor', daysOut: rng.int(4, 12), occurredOn: state.date };
      person.availability = {
        status: 'unavailable',
        reason: 'injury',
        note: 'Rolled his ankle at training',
        until: null,
        discoveredLate: false,
      };
      recordCandidateHistory(state, record, 'Picked up a knock at the session.', state.date);
      lines.push(`${personDisplayName(person)} rolled his ankle — nothing serious, but he is off it for a week or two.`);
    }

    // A good session earns a quiet word; a bad one does not.
    const managerId = club.managerId;
    if (managerId && read.impression === 'impressed') {
      const relationship = getRelationship(state, person.id, managerId);
      if (!relationship) {
        upsertRelationship(state, {
          aId: managerId,
          bId: person.id,
          origin: 'player-manager',
          context: `Trial at ${club.identity.shortName}`,
          aToB: { respect: 60, trust: 48 },
          bToA: { respect: 52, trust: 48 },
        });
      }
      applyRelationshipEvent(state, {
        type: 'teammate-support',
        aId: managerId,
        bId: person.id,
        intensity: 0.5,
        date: state.date,
        clubId: club.id,
        detail: 'after a good session',
      });
    }

    const quality = meanAttributeOf(person);
    result.outcomes.push({
      personId,
      attended: true,
      summary: read.summary,
      impression: read.impression,
    });
    lines.push(
      `${personDisplayName(person)} (${person.preferredPosition}, ${quality >= clubQuality + 1 ? 'better than what you have got' : quality >= clubQuality - 1 ? 'about your level' : 'short of the standard'}) — ${read.summary}`,
    );

    // Players learn about you too, and sometimes that is where the friendship starts.
    const mate = rng.pick(managers.length > 0 ? managers : [person]);
    if (mate.id !== person.id) {
      const relationship = getRelationship(state, person.id, mate.id);
      if (!relationship) {
        upsertRelationship(state, {
          aId: person.id,
          bId: mate.id,
          origin: 'current-teammates',
          context: `Trained with ${club.identity.shortName}`,
          aToB: { friendship: 42, trust: 45 },
          bToA: { friendship: 42, trust: 45 },
        });
      }
    }
  }

  store.pendingTrialIds = [];

  if (lines.length > 0) {
    result.messages.push(lines.join(' '));
    result.events.push(
      createEvent(state, {
        type: 'recruitment',
        importance: 2,
        clubIds: [club.id],
        personIds: result.outcomes.filter((outcome) => outcome.attended).map((outcome) => outcome.personId),
        data: {
          headline: `Session at ${groundName}`,
          body: `${lines.join(' ')}`,
        },
      }),
    );
  }
  return result;
}

/** True when the club has players waiting to come down. */
export function hasPendingTrial(state: GameState): boolean {
  return recruitmentStore(state).pendingTrialIds.length > 0;
}

/** Candidates who have been down to a session and are worth another look. */
export function trialists(state: GameState): PersonId[] {
  return Object.values(recruitmentStore(state).candidates)
    .filter((candidate) => candidate.trials > 0)
    .map((candidate) => candidate.personId);
}