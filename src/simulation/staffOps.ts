import type { GameState } from '@/domain/game';
import type { ClubId, PersonId } from '@/domain/ids';
import type { GameEvent } from '@/domain/news';
import { isOfficial, isPlayer, personDisplayName, type Official } from '@/domain/person';
import { emptyKnowledge } from '@/domain/recruitment';
import { candidatePool } from './recruitment/discovery';
import { characterNotes, mergeKnowledge, readAttributes } from './recruitment/knowledge';
import { squadNeeds } from './recruitment/needs';
import { addCandidate, candidateOf } from './recruitment/store';
import { createEvent } from './news';
import { stream } from './rng';
import { staffCompetence, staffIsAvailable, staffMembers } from './staff';

/**
 * What the committee actually does.
 *
 * The staff system gives a club people; this is where they touch the football.
 * Everything here reads and writes the systems that already own the truth —
 * training quality, the injury countdown, the recruitment knowledge graph — and
 * none of them re-implements one. A man's competence is expressed as a nudge to
 * an existing output, never as a new number the rest of the game has to learn.
 *
 * Small-club realism runs through all of it: no coach, no physio, no scout is a
 * perfectly ordinary state, and the club carries on without them. Staff improve
 * what happens; they are never a dependency.
 */

/** The officials holding a role at a club, in roster order. */
function staffOf(state: GameState, clubId: ClubId, role: string): Official[] {
  const club = state.clubs[clubId];
  if (!club) return [];
  return staffMembers(club)
    .filter((member) => member.role === role)
    .map((member) => state.people[member.personId])
    .filter((person): person is Official => isOfficial(person));
}

/* ------------------------------------------------------------------------ *
 * Physio — recovery, and what he can tell you about a knock
 * ------------------------------------------------------------------------ */

/**
 * How much a club's physio helps a player get back, 0-1.
 *
 * Zero when there is no physio, or when the one there is unavailable this week.
 * It scales recovery through the existing `recoverPlayerDaily`; it never sets or
 * clears an injury itself.
 */
export function physioSupport(state: GameState, clubId: ClubId): number {
  const physio = staffOf(state, clubId, 'physio')[0];
  if (!physio || !staffIsAvailable(physio)) return 0;
  return staffCompetence(physio, 'physio') / 20;
}

export interface InjuryAssessment {
  personId: PersonId;
  name: string;
  injury: string;
  /** The physio's estimate, in days — an opinion, not the countdown itself. */
  estimateDays: number;
  /** How much to trust the estimate. */
  confidence: 'sure' | 'fair' | 'guessing';
}

export interface PhysioReport {
  physioName: string | null;
  available: boolean;
  /** 1-20 competence, or 0 when there is nobody. */
  competence: number;
  assessments: InjuryAssessment[];
}

/**
 * The physio's read on the club's walking wounded.
 *
 * A good physio gives you a close estimate and says so; a poor one guesses, and
 * his guess drifts from the real countdown. With no physio (or one who is away)
 * the manager only has what he can see, which is the true figure with no
 * confident opinion around it. The authoritative injury state is untouched.
 */
export function physioReport(state: GameState, clubId: ClubId = state.userClubId): PhysioReport {
  const club = state.clubs[clubId];
  const physio = staffOf(state, clubId, 'physio')[0];
  if (!club) return { physioName: null, available: false, competence: 0, assessments: [] };

  if (!physio) {
    return { physioName: null, available: false, competence: 0, assessments: assessInjuries(state, club.squadIds, null) };
  }

  const available = staffIsAvailable(physio);
  const competence = staffCompetence(physio, 'physio');
  return {
    physioName: `${physio.firstName} ${physio.surname}`,
    available,
    competence,
    assessments: assessInjuries(state, club.squadIds, available ? physio : null),
  };
}

function assessInjuries(state: GameState, squadIds: readonly PersonId[], physio: Official | null): InjuryAssessment[] {
  const assessments: InjuryAssessment[] = [];
  for (const id of squadIds) {
    const person = state.people[id];
    if (!isPlayer(person) || !person.injury) continue;
    const trueDays = person.injury.daysOut;
    if (!physio) {
      assessments.push({
        personId: person.id,
        name: personDisplayName(person),
        injury: person.injury.description,
        estimateDays: trueDays,
        confidence: 'fair',
      });
      continue;
    }
    const rng = stream(state.seed, 'physio-assessment', person.id, state.date);
    const quality = staffCompetence(physio, 'physio') / 20;
    const error = Math.round(rng.gaussian(0, (1 - quality) * 6));
    assessments.push({
      personId: person.id,
      name: personDisplayName(person),
      injury: person.injury.description,
      estimateDays: Math.max(0, trueDays + error),
      confidence: quality >= 0.7 ? 'sure' : quality >= 0.45 ? 'fair' : 'guessing',
    });
  }
  return assessments;
}

/* ------------------------------------------------------------------------ *
 * Assistant — advice, and how much of it you can trust
 * ------------------------------------------------------------------------ */

export interface StaffAdviceLine {
  tone: 'accent' | 'warn' | 'muted';
  text: string;
}

export interface AssistantAdvice {
  available: boolean;
  assistantName: string | null;
  /** 1-20 competence, or 0 when there is nobody. */
  competence: number;
  lines: StaffAdviceLine[];
}

/**
 * What the assistant makes of the squad this week.
 *
 * The advice is drawn from real squad facts — knocks, fitness, form, thin
 * positions — so it is always *about* something. Competence decides how much of
 * it you get: a good assistant sees the whole picture and tells you all of it;
 * a limited one spots one thing. It is advice, never an instruction, and it
 * changes nothing on its own.
 */
export function assistantAdvice(state: GameState, clubId: ClubId = state.userClubId): AssistantAdvice {
  const club = state.clubs[clubId];
  const assistant = staffOf(state, clubId, 'assistant')[0];
  if (!club || !assistant) return { available: false, assistantName: null, competence: 0, lines: [] };

  const assistantName = `${assistant.firstName} ${assistant.surname}`;
  const competence = staffCompetence(assistant, 'assistant');
  if (!staffIsAvailable(assistant)) return { available: false, assistantName, competence, lines: [] };

  const squad = club.squadIds.map((id) => state.people[id]).filter(isPlayer);

  const pool: StaffAdviceLine[] = [];
  const carrying = squad.filter((player) => player.injury).length;
  if (carrying > 0) pool.push({ tone: 'warn', text: `${carrying} are carrying knocks — go easy on the fitness work.` });

  const unfit = squad.filter((player) => player.fitness < 70).length;
  if (unfit > 0) pool.push({ tone: 'accent', text: `${unfit} look short of a game — the legs need the work.` });

  const offForm = squad.filter((player) => player.form < 40).length;
  if (offForm > 0) pool.push({ tone: 'muted', text: `${offForm} are out of form; a quiet word might do more than a session.` });

  const needs = squadNeeds(state, clubId);
  if (needs.thinGroups.length > 0) {
    pool.push({ tone: 'accent', text: `We are thin at ${needs.thinGroups.join(', ')} — worth keeping an eye open.` });
  }

  if (pool.length === 0) {
    pool.push({ tone: 'muted', text: 'Nothing is obviously wrong — keep doing what we are doing.' });
  }

  const wanted = Math.max(1, Math.min(pool.length, Math.round((competence / 20) * 3)));
  // The lines themselves are rooted in fact; a limited assistant simply sees
  // fewer of them, because he notices less.
  return { available: true, assistantName, competence, lines: pool.slice(0, wanted) };
}

/* ------------------------------------------------------------------------ *
 * Scout — finding players through the existing recruitment system
 * ------------------------------------------------------------------------ */

export interface ScoutReportOutcome {
  events: GameEvent[];
  discovered: PersonId[];
  messages: string[];
}

/**
 * The scout's week.
 *
 * A scout goes and watches somebody and comes back with a report. It uses the
 * recruitment system's own knowledge graph (`readAttributes`, `mergeKnowledge`,
 * `addCandidate`) exactly as a recommendation or a night at five-a-side does: the
 * name lands on the existing candidate list with a source and a confidence. A
 * better scout travels further, watches more often, and comes back with a
 * fuller, truer read.
 */
export function weeklyScoutReports(state: GameState, clubId: ClubId = state.userClubId): ScoutReportOutcome {
  const out: ScoutReportOutcome = { events: [], discovered: [], messages: [] };
  const club = state.clubs[clubId];
  if (!club) return out;
  const scouts = staffOf(state, clubId, 'scout').filter(staffIsAvailable);
  if (scouts.length === 0) return out;

  const needs = squadNeeds(state, clubId);
  const pool = candidatePool(state, clubId);

  for (const scout of scouts) {
    const competence = staffCompetence(scout, 'scout') / 20;
    const rng = stream(state.seed, 'scout-report', state.season.id, clubId, scout.id, state.date);
    if (!rng.chance(0.16 + competence * 0.34)) continue;

    // A good scout has the contacts to hear about somebody further out.
    const reach = 6 + competence * 16;
    const options = pool.filter((entry) => entry.distanceKm <= reach && entry.player.age <= 40);
    if (options.length === 0) continue;

    const pick = rng.weighted(
      options.map((entry) => ({
        value: entry,
        weight:
          Math.max(0.2, 1 - entry.distanceKm / (reach + 4)) +
          (needs.thinGroups.includes(entry.player.positionGroup) ? 0.8 : 0) +
          (entry.unattached ? 0.3 : 0),
      })),
    );

    const existing = candidateOf(state, pick.player.id);
    if (existing && existing.discoveredOn === state.date) continue;

    const read = readAttributes({
      rng,
      player: pick.player,
      source: { label: `${scout.firstName} ${scout.surname} says`, confidence: 'reported' },
      date: state.date,
      coverage: Math.max(0.2, Math.min(0.85, 0.3 + competence * 0.5)),
      accuracy: Math.max(0.25, Math.min(0.9, 0.4 + competence * 0.5)),
    });
    const notes = characterNotes(rng, pick.player, 2);
    const knowledge = mergeKnowledge(emptyKnowledge(), read, notes);
    const note = `${scout.firstName} ${scout.surname} has been out watching and reckons he could do a job at ${pick.player.preferredPosition}.`;

    addCandidate(state, {
      personId: pick.player.id,
      discoveredVia: 'scout',
      sourcePersonId: scout.id,
      sourceNote: note,
      sentiment: 'neutral',
      knowledge,
    });
    out.discovered.push(pick.player.id);
    out.messages.push(`${note} ${personDisplayName(pick.player)} is on your list.`);
    out.events.push(
      createEvent(state, {
        type: 'recruitment',
        importance: 2,
        clubIds: [club.id],
        personIds: [pick.player.id, scout.id],
        data: {
          headline: `${scout.firstName} ${scout.surname} has a name for you`,
          body: `${note}`,
        },
      }),
    );
  }

  return out;
}
