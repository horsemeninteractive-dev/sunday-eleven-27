import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, PersonId } from '@/domain/ids';
import type { Ground } from '@/domain/world';
import type { PitchCondition, Weather } from '@/domain/match';
import { isPlayer, type Official, type Player } from '@/domain/person';
import {
  TRAINING_LENGTH_MINUTES,
  blockCapacity,
  type TrainingAdvice,
  type TrainingAttendanceEntry,
  type TrainingBlockId,
  type TrainingLength,
  type TrainingPlan,
} from '@/domain/training';
import { addDays, daysBetween, monthOf } from '../calendar';
import { nextFixtureFor } from '../schedule';
import { rollMatchConditions } from '../matchday';
import { stream } from '../rng';
import { fiveASideVenueFor } from '../recruitment/discovery';
import { staffIsAvailable } from '../staff';
import { clubCohesionValue, clubSystemFamiliarity } from './cohesion';
import { lastSessionFor, trainingStore, weeksSince } from './store';
import { isLeagueMatchday, nextMatchday, weekStartOf } from '../timeline';

/**
 * Planning the week's session: what the manager has set up, who is likely to be
 * there, and what the evening is going to look like.
 *
 * Nothing on this screen is a prediction of the *result* — the weather and the
 * pitch are forecasts, the attendance is an expectation — because half of
 * grassroots training is finding out who actually turns up.
 */

/** The routine a club falls back on when nobody has set anything else. */
export function defaultPlan(clubId: ClubId, matchday: number): TrainingPlan {
  return {
    clubId,
    matchday,
    length: 'normal',
    blocks: ['warm-up', 'possession', 'tactical', 'teamwork'],
    fallbackVenue: false,
  };
}

/** Different clubs do different things on a Thursday, but only a little. */
export function aiPlanFor(state: GameState, clubId: ClubId, matchday: number): TrainingPlan {
  const rng = stream(state.seed, 'training-plan', state.season.id, clubId, matchday);
  const club = state.clubs[clubId];
  const quality = club ? club.reputation : 40;
  const lengths: TrainingLength[] = quality > 60 ? ['normal', 'long', 'normal'] : ['normal', 'short', 'normal'];
  const length = rng.pick(lengths);
  const pool: TrainingBlockId[] = quality > 60
    ? ['warm-up', 'possession', 'tactical', 'set-pieces', 'attacking', 'teamwork', 'fitness']
    : ['warm-up', 'possession', 'fitness', 'attacking', 'defending', 'teamwork'];
  const capacity = blockCapacity(length);
  const blocks: TrainingBlockId[] = ['warm-up'];
  while (blocks.length < capacity) {
    const pick = rng.pick(pool);
    if (!blocks.includes(pick)) blocks.push(pick);
  }
  return { clubId, matchday, length, blocks, fallbackVenue: rng.chance(quality > 55 ? 0.35 : 0.12) };
}

/**
 * The plan in force for the coming week. Clubs carry their routine over from
 * week to week, so a plan set last Thursday is still what happens this
 * Thursday unless the manager changes it.
 */
export function currentPlan(state: GameState, clubId: ClubId, matchday = currentSessionKey(state)): TrainingPlan {
  const stored = trainingStore(state).plans[clubId];
  if (stored) {
    if (stored.matchday !== matchday) {
      stored.matchday = matchday;
      stored.blocks = [...stored.blocks];
    }
    return stored;
  }
  const plan = clubId === state.userClubId ? defaultPlan(clubId, matchday) : aiPlanFor(state, clubId, matchday);
  trainingStore(state).plans[clubId] = plan;
  return plan;
}

/** Store the manager's choices for the coming week. */
export function savePlan(state: GameState, plan: TrainingPlan): TrainingPlan {
  const normalised: TrainingPlan = {
    clubId: plan.clubId,
    matchday: plan.matchday,
    length: plan.length,
    blocks: [...plan.blocks],
    fallbackVenue: plan.fallbackVenue,
  };
  trainingStore(state).plans[plan.clubId] = normalised;
  return normalised;
}

export interface PlanProblem {
  severity: 'error' | 'warning';
  message: string;
}

/** Rules a session has to satisfy, expressed the way the manager would hear them. */
export function validatePlan(plan: TrainingPlan): PlanProblem[] {
  const problems: PlanProblem[] = [];
  const capacity = blockCapacity(plan.length);
  const blocks = plan.blocks;

  if (blocks.length === 0) {
    problems.push({ severity: 'error', message: 'Nothing planned yet — pick at least one block.' });
  }
  if (new Set(blocks).size !== blocks.length) {
    problems.push({ severity: 'error', message: 'The same block is down twice.' });
  }
  if (blocks.length > capacity) {
    problems.push({
      severity: 'error',
      message: `A ${plan.length} session only fits ${capacity} blocks — you have ${blocks.length}.`,
    });
  }
  if (!blocks.includes('warm-up') && blocks.length > 0) {
    problems.push({
      severity: 'warning',
      message: 'No warm-up. Straight into it is how knees and hamstrings go.',
    });
  }
  if (blocks.includes('fitness') && blocks.includes('tactical') && plan.length === 'long') {
    problems.push({
      severity: 'warning',
      message: 'Two hours with fitness and tactical work in it will be a long night for the older lads.',
    });
  }
  return problems;
}

/** The date and place of the session for a given matchday, or pre-season week. */
export function sessionDateFor(state: GameState, matchday: number): ISODate {
  if (matchday < 0) {
    // Pre-season weeks are numbered backwards from matchday one, so this one is
    // that many weeks before the manager's first Monday — plus the three days
    // that land it on the Thursday.
    return addDays(weekStartOf(state.season.startDate), (-matchday - 1) * 7 + 3);
  }
  const entry = state.season.calendar.find((candidate) => candidate.matchday === matchday);
  const matchDate = entry?.date ?? state.date;
  return addDays(matchDate, -3);
}

/**
 * Every Thursday the club trains: the pre-season weeks first, then the league
 * weeks, each one three days before the game it builds towards.
 *
 * A pre-season with no sessions in it is not a pre-season — it is six weeks of
 * waiting — so the club's week runs from the day the manager takes charge, not
 * from the first fixture.
 *
 * Only *league* matchdays have a Thursday. The calendar also carries cup ties,
 * which are numbered after the league's matchdays but dated on the free Sunday
 * of the off-week; giving each a session of its own would land one on a Thursday
 * in the off-week and put a second session in the same fortnight. A cup tie is
 * covered by the league week it sits inside, the same Thursday session that
 * builds towards the Sunday.
 */
export function sessionDatesFor(state: GameState): ISODate[] {
  const dates = state.season.calendar
    .filter((entry) => isLeagueMatchday(state, entry.matchday))
    .map((entry) => addDays(entry.date, -3));
  const firstLeagueSession = dates[0];
  if (!firstLeagueSession) return dates;
  let cursor = weekStartOf(state.season.startDate);
  while (addDays(cursor, 3) < firstLeagueSession) {
    const thursday = addDays(cursor, 3);
    if (thursday >= state.season.startDate) dates.push(thursday);
    cursor = addDays(cursor, 7);
  }
  return dates.sort();
}

/**
 * Which session a Thursday belongs to.
 *
 * A league week is numbered by the matchday it leads to. A pre-season week is
 * numbered backwards from matchday one and kept negative, so the two can never
 * be confused — but it is still one key per week, which is what stops a club
 * training twice in a week or not at all.
 */
/**
 * The session in hand: the one the manager plans for and runs right now.
 *
 * Keyed exactly as the calendar keys it — the matchday a league Thursday
 * builds towards, or the negative pre-season week before the season starts —
 * so the weeks of pre-season do not all collapse onto matchday one. Standing
 * on a Thursday it is that night's session; otherwise it is the next one.
 */
export function currentSessionKey(state: GameState, date: ISODate = state.date): number {
  const dates = sessionDatesFor(state);
  if (dates.includes(date)) return sessionKeyFor(state, date);
  const next = dates.find((candidate) => candidate >= date);
  return next ? sessionKeyFor(state, next) : nextMatchday(state);
}

export function sessionKeyFor(state: GameState, date: ISODate): number {
  const entry = state.season.calendar.find(
    (candidate) => isLeagueMatchday(state, candidate.matchday) && addDays(candidate.date, -3) === date,
  );
  if (entry) return entry.matchday;
  // Counted in whole weeks from the manager's first Monday, so no two weeks of
  // pre-season can end up sharing a key.
  const weeksBefore = Math.round(daysBetween(weekStartOf(state.season.startDate), weekStartOf(date)) / 7);
  return -(weeksBefore + 1);
}

export function trainingGroundFor(state: GameState, clubId: ClubId): Ground | undefined {
  const club = state.clubs[clubId];
  if (!club) return undefined;
  return state.world.grounds[club.groundId];
}

export interface AttendanceExpectation {
  entries: TrainingAttendanceEntry[];
  attending: PersonId[];
  doubtful: PersonId[];
  absent: PersonId[];
  /** Candidates who have been asked down for a look. */
  trialists: PersonId[];
  /** 0-1 of the squad expected on the grass. */
  ratio: number;
}

/**
 * Who is likely to be there. This uses the existing availability system and
 * nothing else: a man who is unavailable this week is unavailable for
 * training too, and a doubt is a doubt. On top of that there is the ordinary
 * Thursday attrition — shifts, kids, a car that will not start — which is not a
 * change of availability, just the reality of the evening.
 */
export function expectedAttendance(state: GameState, clubId: ClubId): AttendanceExpectation {
  const club = state.clubs[clubId];
  const entries: TrainingAttendanceEntry[] = [];
  const attending: PersonId[] = [];
  const doubtful: PersonId[] = [];
  const absent: PersonId[] = [];
  if (!club) return { entries, attending, doubtful, absent, trialists: [], ratio: 0 };

  for (const playerId of club.squadIds) {
    const person = state.people[playerId];
    if (!isPlayer(person)) continue;
    const player: Player = person;
    if (player.availability.status === 'unavailable') {
      entries.push({ personId: player.id, status: 'absent', reason: player.availability.note ?? 'unavailable' });
      absent.push(player.id);
      continue;
    }
    const turnout = trainingTurnoutChance(state, player);
    if (player.availability.status === 'doubtful') {
      if (turnout > 0.45) {
        entries.push({ personId: player.id, status: 'doubtful', reason: player.availability.note });
        doubtful.push(player.id);
      } else {
        entries.push({
          personId: player.id,
          status: 'absent',
          reason: player.availability.note ?? 'touch and go all week',
        });
        absent.push(player.id);
      }
      continue;
    }
    // The forecast is deliberately a shade optimistic-but-honest: a manager
    // who counts a coin-flip as a yes always ends up one short on the night.
    if (turnout >= 0.62) {
      entries.push({ personId: player.id, status: 'attending', reason: null });
      attending.push(player.id);
    } else if (turnout >= 0.42) {
      entries.push({ personId: player.id, status: 'doubtful', reason: 'usually a bit hit and miss' });
      doubtful.push(player.id);
    } else {
      entries.push({ personId: player.id, status: 'absent', reason: 'hardly ever turns up on a Thursday' });
      absent.push(player.id);
    }
  }

  const trialists = pendingTrialists(state);

  const ratio = club.squadIds.length > 0 ? (attending.length + doubtful.length * 0.5) / club.squadIds.length : 0;
  return { entries, attending, doubtful, absent, trialists, ratio };
}

/** Players who have been asked down to a session and have not been in yet. */
function pendingTrialists(state: GameState): PersonId[] {
  const recruitment = state.recruitment as { pendingTrialIds?: PersonId[] } | undefined;
  return recruitment?.pendingTrialIds ? [...recruitment.pendingTrialIds] : [];
}

/**
 * Whether a player bothers turning up on a Thursday. Reliability is the biggest
 * factor, then how much he wants to be there: senior players with families and
 * a long drive are the ones who drift.
 */
export function trainingTurnoutChance(state: GameState, player: Player): number {
  const reliability = player.attributes.behavioural.reliability / 20;
  const commitment = player.attributes.behavioural.commitment / 20;
  const ambition = player.attributes.behavioural.ambition / 20;
  const awayFromHome = player.homeGroundId && player.homeGroundId !== (player.clubId ? state.clubs[player.clubId]?.groundId : null);
  let chance = 0.42 + reliability * 0.36 + commitment * 0.18 + ambition * 0.08;
  if (player.age >= 32) chance -= 0.05;
  if (player.age <= 21) chance += 0.04;
  if (awayFromHome) chance -= 0.04;
  const moraleFactor = (player.morale - 55) / 100;
  chance += moraleFactor * 0.08;
  return Math.max(0.05, Math.min(0.97, chance));
}

export interface SessionForecast {
  date: ISODate;
  /** Days until the session; 0 or negative means it has already happened. */
  daysAway: number;
  matchday: number;
  venueName: string;
  /** The hall, if the club has arranged to fall back on one. */
  fallbackVenueName: string;
  indoorGround: boolean;
  weather: Weather;
  pitch: PitchCondition;
  temperatureC: number;
  /** True when the pitch is likely to stop play. */
  conditionsPoor: boolean;
  hasFloodlights: boolean;
  shortEvening: boolean;
  attendance: AttendanceExpectation;
  coachName: string;
  coachRole: string;
  coachQuality: number;
  length: TrainingLength;
  minutes: number;
  blocks: TrainingBlockId[];
  problems: PlanProblem[];
  advice: TrainingAdvice[];
  cohesion: number;
  familiarity: number;
}

/** Everything the training screen needs for the coming week. */
export function sessionForecast(state: GameState, clubId: ClubId): SessionForecast {
  const matchday = currentSessionKey(state);
  const plan = currentPlan(state, clubId, matchday);
  const date = sessionDateFor(state, matchday);
  const ground = trainingGroundFor(state, clubId);
  const rng = stream(state.seed, 'training', 'conditions', clubId, state.season.id, matchday);
  const conditions = ground
    ? rollMatchConditions(rng, ground, date)
    : { weather: 'overcast' as Weather, pitch: 'worn' as PitchCondition, pitchQuality: 10, temperatureC: 10 };
  const venueName = ground?.name ?? 'the Rec';
  const club = state.clubs[clubId];
  const fallbackVenueName = club ? fiveASideVenueFor(state, club.townId).name : 'the sports hall';
  const attendance = expectedAttendance(state, clubId);
  const coach = sessionCoachFor(state, clubId);
  const minutes = TRAINING_LENGTH_MINUTES[plan.length];
  const month = monthOf(date);
  const shortEvening = !ground?.hasFloodlights && (month === 11 || month <= 1);
  const conditionsPoor = conditions.pitch === 'waterlogged' || conditions.pitch === 'frozen';
  const familiarity = clubSystemFamiliarity(state, clubId);

  return {
    date,
    daysAway: daysBetween(state.date, date),
    matchday,
    venueName,
    fallbackVenueName,
    indoorGround: ground?.surface === '3G',
    weather: conditions.weather,
    pitch: conditions.pitch,
    temperatureC: conditions.temperatureC,
    conditionsPoor,
    hasFloodlights: Boolean(ground?.hasFloodlights),
    shortEvening,
    attendance,
    coachName: coach.name,
    coachRole: coach.role,
    coachQuality: coach.quality,
    length: plan.length,
    minutes,
    blocks: plan.blocks,
    problems: validatePlan(plan),
    advice: trainingAdvice(state, clubId, plan),
    cohesion: clubCohesionValue(state, clubId),
    familiarity,
  };
}

/**
 * Who runs the session.
 *
 * The coach whose job it is takes it if he is around; if he is not, the
 * assistant does; if neither is, the manager does it himself. A club with no
 * coach at all is normal at this level and is not a problem — the session still
 * happens, and the quality of the evening drops with whoever ends up with the
 * bibs. Being unavailable (a shift, a holiday) simply takes a man out of the
 * running, exactly as it takes a player out of the squad.
 */
export function sessionCoachFor(
  state: GameState,
  clubId: ClubId,
): { personId: PersonId | null; name: string; role: string; quality: number } {
  const club = state.clubs[clubId];
  if (!club) return { personId: null, name: 'Nobody', role: 'no coach', quality: 0.3 };
  const manager = club.managerId ? state.people[club.managerId] : undefined;
  const roster = club.staff;
  const availableOfficial = (id: PersonId | null | undefined): Official | null => {
    const person = id ? state.people[id] : undefined;
    return person && person.kind === 'official' && staffIsAvailable(person) ? person : null;
  };
  const coach = availableOfficial(roster?.coachIds?.[0]);
  const assistant = availableOfficial(roster?.assistantId);
  const managerOfficial =
    manager && manager.kind === 'official' && staffIsAvailable(manager) ? manager : null;
  const staff = coach ?? assistant ?? managerOfficial;
  if (staff) {
    // Defensive about the attributes: an official created by an older save, or
    // by a future staff system, may not carry every field yet.
    const attributes = staff.attributes;
    const value = (key: keyof typeof attributes) => (typeof attributes[key] === 'number' ? (attributes[key] as number) : 11);
    const quality = Math.max(
      0.15,
      Math.min(
        1,
        (value('coaching') / 20) * 0.42 +
          (value('motivation') / 20) * 0.24 +
          (value('organisation') / 20) * 0.2 +
          (value('manManagement') / 20) * 0.14,
      ),
    );
    return {
      personId: staff.id,
      name: `${staff.firstName} ${staff.surname}`,
      role: staff.role,
      quality,
    };
  }

  const squad = club.squadIds.map((id) => state.people[id]).filter(isPlayer);
  // A player-manager picks the team and takes the session, without a coaching
  // badge to his name: he gets by on knowing the game and being listened to.
  const playerManager = manager && isPlayer(manager) ? manager : squad.find((player) => player.isPlayerManager);
  if (playerManager) {
    const attributes = playerManager.attributes;
    return {
      personId: playerManager.id,
      name: `${playerManager.firstName} ${playerManager.surname}`,
      role: 'player-manager',
      quality: Math.min(
        0.85,
        0.3 +
          (attributes.hidden.tacticalIntelligence / 20) * 0.25 +
          (attributes.mental.determination / 20) * 0.15 +
          (attributes.mental.workRate / 20) * 0.1,
      ),
    };
  }

  // No staff at all: the oldest head in the dressing room runs it.
  const senior = [...squad].sort((a, b) => b.age - a.age)[0];
  if (senior) {
    return {
      personId: senior.id,
      name: `${senior.firstName} ${senior.surname}`,
      role: 'the senior lads',
      quality: 0.35,
    };
  }
  return { personId: null, name: 'Nobody', role: 'no coach', quality: 0.3 };
}

/**
 * What the manager would reasonably be told before the session. Advice, never
 * instructions: the state of the squad suggests things, it does not decide.
 */
export function trainingAdvice(state: GameState, clubId: ClubId, plan: TrainingPlan): TrainingAdvice[] {
  const advice: TrainingAdvice[] = [];
  const club = state.clubs[clubId];
  if (!club) return advice;
  const squad = club.squadIds.map((id) => state.people[id]).filter(isPlayer);
  if (squad.length === 0) return advice;

  const shortOfFitness = squad.filter((player) => player.fitness < 78).length;
  if (shortOfFitness >= 4) {
    advice.push({
      tone: 'warn',
      text: `${shortOfFitness} lads are short of match fitness — a fitness block would help, but they will feel it Sunday.`,
    });
  }

  const rusty = squad.filter((player) => player.systemFamiliarity && player.systemFamiliarity.formation < 11).length;
  if (rusty >= squad.length - 1) {
    advice.push({
      tone: 'accent',
      text: 'The whole squad is still learning the shape. Tactical or teamwork work is worth more than shooting practice right now.',
    });
  } else if (rusty >= 8) {
    advice.push({
      tone: 'accent',
      text: `${rusty} of the squad are still learning the shape. Tactical or teamwork work is worth more than shooting practice right now.`,
    });
  }

  // Only genuine mid-season arrivals: everybody signed in pre-season has been
  // training together all summer.
  const arrivals = squad.filter(
    (player) => player.joinedClubOn > state.season.startDate && weeksSince(player.joinedClubOn, state.date) <= 6,
  );
  if (arrivals.length >= 2) {
    advice.push({ tone: 'muted', text: `${arrivals.length} new faces have barely trained together yet.` });
  }

  const absent = squad.filter((player) => player.availability.status !== 'available').length;
  if (absent >= squad.length * 0.3) {
    advice.push({ tone: 'warn', text: `Attendance looks thin this week — ${absent} are out or doubtful.` });
  }

  const carrying = squad.filter((player) => player.injury).length;
  if (carrying > 0 && plan.blocks.includes('fitness')) {
    advice.push({ tone: 'warn', text: `${carrying} are carrying knocks. Fitness work on top of that is asking for trouble.` });
  }

  if (!plan.blocks.includes('warm-up')) {
    advice.push({ tone: 'warn', text: 'No warm-up planned.' });
  }

  const opponent = nextOpponent(state, clubId);
  if (opponent && opponent.reputation > club.reputation + 8) {
    advice.push({ tone: 'muted', text: `Tougher game than usual on Sunday (${opponent.identity.shortName}).` });
  }

  const last = lastSessionFor(state, clubId);
  if (last && last.attended <= 10) {
    advice.push({ tone: 'warn', text: `Only ${last.attended} turned up last week.` });
  }

  const levels = new Set(squad.map((player) => (player.attributes.hidden.adaptability >= 14 ? 'quick' : 'slow')));
  if (!levels.has('quick')) {
    advice.push({ tone: 'muted', text: 'Nobody in the squad picks things up quickly — repetition is the only way with this lot.' });
  }

  return advice.slice(0, 5);
}

/** The next game, friendly or league: in pre-season that is who the session is
 * for, and it is the friendly rather than the fixture in September. */
function nextOpponent(state: GameState, clubId: ClubId) {
  const match = nextFixtureFor(state, clubId, state.date);
  if (!match) return undefined;
  const opponentId = match.homeClubId === clubId ? match.awayClubId : match.homeClubId;
  return state.clubs[opponentId];
}
