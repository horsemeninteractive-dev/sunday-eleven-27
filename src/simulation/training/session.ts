import type { GameState } from '@/domain/game';
import type { ClubId, PersonId } from '@/domain/ids';
import type { GameEvent } from '@/domain/news';
import { isPlayer, type Player } from '@/domain/person';
import { POSITIONS, type PositionCode } from '@/domain/positions';
import {
  TRAINING_BLOCKS,
  TRAINING_LENGTH_MINUTES,
  sessionBlockMinutes,
  type TrainingAttendanceEntry,
  type TrainingBlockId,
  type TrainingSession,
  type TrainingStandout,
} from '@/domain/training';
import { addDays, formatDayMonth, monthOf } from '../calendar';
import { addLedgerEntry } from '../finance';
import { rollMatchConditions } from '../matchday';
import { createEvent } from '../news';
import { applyRelationshipEvent, getRelationship, personName, recordInteraction } from '../relationships';
import { runTrialSession } from '../recruitment/trials';
import { stream } from '../rng';
import { leagueClubIds } from '../pyramid';
import { clubCohesionValue, clubSystemFamiliarity, gainSystemFamiliarity, nudgePositionalFamiliarity, rebaseSystemFamiliarity, rustSystemFamiliarity } from './cohesion';
import { accrueDevelopment, applyDecline, applyImprovements } from './development';
import {
  currentPlan,
  currentSessionKey,
  expectedAttendance,
  sessionCoachFor,
  sessionDateFor,
  trainingGroundFor,
  trainingTurnoutChance,
} from './plan';
import { recordSession, sessionRecordedFor, sessionsFor, weeksSince } from './store';

/**
 * Thursday night.
 *
 * Half the squad come straight from work, two are carrying knocks, the new
 * centre half is still learning where to stand, and somebody's car will not
 * start. The session is run, the evening is judged, and the squad comes out of
 * it with tired legs, a little more idea of what they are doing, and — very
 * occasionally — something the manager notices.
 */

export interface TrainingOutcome {
  events: GameEvent[];
  session: TrainingSession | null;
  /** Lines the manager is shown straight away. */
  messages: string[];
}

function emptyOutcome(): TrainingOutcome {
  return { events: [], session: null, messages: [] };
}

/**
 * Run this week's session for one club, once.
 *
 * Called by the daily engine on the session's own date, and by the store when
 * the manager takes the session himself or before a match kicks off. It is
 * therefore guarded: a club cannot train twice for the same matchday.
 */
export function conductTraining(state: GameState, clubId: ClubId, matchday: number): TrainingOutcome {
  const club = state.clubs[clubId];
  if (!club) return emptyOutcome();
  if (sessionRecordedFor(state, clubId, matchday)) return emptyOutcome();

  const date = sessionDateFor(state, matchday);
  const isUserClub = clubId === state.userClubId;
  const plan = currentPlan(state, clubId, matchday);
  const ground = trainingGroundFor(state, clubId);
  const rng = stream(state.seed, 'training-session', state.season.id, clubId, matchday);
  const conditions = ground
    ? rollMatchConditions(stream(state.seed, 'training', 'conditions', clubId, state.season.id, matchday), ground, date)
    : { weather: 'overcast' as const, pitch: 'worn' as const, pitchQuality: 10, temperatureC: 10 };

  // Changing the way the team plays costs familiarity before anything else this
  // week happens.
  rebaseSystemFamiliarity(state, clubId);

  const coach = sessionCoachFor(state, clubId);
  const expectation = expectedAttendance(state, clubId);
  const venueName = ground?.name ?? 'the Rec';
  const fallbackName = isUserClub ? hallNameFor(state, clubId) : `${state.world.towns[club.townId]?.name ?? 'the village'} Leisure Centre`;

  // --- Who is actually coming -------------------------------------------------
  const entries: TrainingAttendanceEntry[] = [];
  const attendees: PersonId[] = [];
  /** He was at the leisure centre instead of down at the ground. */
  const fiveASideIds: PersonId[] = [];
  let doubtful = 0;
  let absent = 0;

  for (const playerId of club.squadIds) {
    const person = state.people[playerId];
    if (!isPlayer(person)) continue;
    const player: Player = person;
    if (player.availability.status === 'unavailable') {
      entries.push({ personId: player.id, status: 'absent', reason: player.availability.note ?? 'unavailable' });
      absent += 1;
      continue;
    }
    // The Thursday no-show: he said he would be there, and then he was not.
    if (rng.chance(0.07)) {
      const reason = trainingAbsenceReason(rng);
      entries.push({ personId: player.id, status: 'absent', reason });
      if (reason === FIVE_A_SIDE_REASON) fiveASideIds.push(player.id);
      absent += 1;
      continue;
    }
    const chance = trainingTurnoutChance(state, player) + rng.gaussian(0, 0.07);
    const doubting = player.availability.status === 'doubtful';
    if (doubting) {
      if (chance > 0.45) {
        entries.push({ personId: player.id, status: 'doubtful', reason: player.availability.note });
        doubtful += 1;
      } else {
        entries.push({ personId: player.id, status: 'absent', reason: player.availability.note ?? 'never made it' });
        absent += 1;
      }
      continue;
    }
    if (chance >= 0.5) {
      entries.push({ personId: player.id, status: 'attending', reason: null });
      attendees.push(player.id);
    } else {
      const reason = trainingAbsenceReason(rng);
      entries.push({ personId: player.id, status: 'absent', reason });
      if (reason === FIVE_A_SIDE_REASON) fiveASideIds.push(player.id);
      absent += 1;
    }
  }

  const trialistIds = isUserClub ? trialistIdsFor(state) : [];
  const trialistsAttending: PersonId[] = [];
  for (const personId of trialistIds) {
    const person = state.people[personId];
    if (!isPlayer(person)) continue;
    if (person.availability.status === 'unavailable') {
      entries.push({ personId, status: 'absent', reason: person.availability.note ?? 'could not make it' });
      absent += 1;
      continue;
    }
    if (rng.chance(0.82)) {
      entries.push({ personId, status: 'trialist', reason: 'down for a look' });
      trialistsAttending.push(personId);
      attendees.push(personId);
    } else {
      entries.push({ personId, status: 'absent', reason: 'said he would come and did not' });
      absent += 1;
    }
  }

  // Rust applies whatever happens: a week is a week.
  rustSystemFamiliarity(state, clubId, new Set(attendees));

  // --- Did it happen at all? ---------------------------------------------------
  let cancelled = false;
  let cancelReason: string | null = null;
  let indoor = ground?.surface === '3G';
  let usedVenueName = venueName;
  /** True when the club paid to hire a hall because the normal pitch was unfit. */
  let hiredHall = false;
  const events: GameEvent[] = [];

  const pitchUnfit = conditions.pitch === 'waterlogged' || conditions.pitch === 'frozen';
  if (pitchUnfit && !indoor) {
    if (plan.fallbackVenue && rng.chance(0.85)) {
      indoor = true;
      hiredHall = true;
      usedVenueName = fallbackName;
      const cost = rng.int(18, 32);
      addLedgerEntry(state, clubId, {
        date,
        description: 'Sports hall hire — pitch unfit',
        category: 'pitch-hire',
        amount: -cost,
      });
      if (isUserClub) {
        events.push(
          createEvent(state, {
            type: 'training',
            importance: 1,
            clubIds: [clubId],
            data: {
              headline: 'Training moved indoors',
              body: `The ${conditions.pitch === 'frozen' ? 'pitch was frozen' : 'pitch was under water'}, so the session went ahead at ${fallbackName} instead. It cost £${cost} to hire.`,
            },
          }),
        );
      }
    } else {
      cancelled = true;
      cancelReason =
        conditions.pitch === 'frozen'
          ? `Frozen pitch — the ground staff called it off`
          : `Waterlogged pitch — nobody was standing for that`;
    }
  }

  if (!cancelled && attendees.length < 5) {
    cancelled = true;
    cancelReason = `Only ${attendees.length} turned up — not worth getting the balls out`;
  }

  if (!cancelled && rng.chance(0.02)) {
    cancelled = true;
    cancelReason = rng.pick([
      'The changing rooms were locked and nobody had a key',
      'The council padlocked the gate — a booking mix-up',
      'The floodlights went out five minutes after we started',
    ]);
  }

  // The training pitch has to be paid for, and it is charged on the night the
  // session is actually held — a cancelled session costs the club nothing. When
  // the weather has already moved the club into a hired hall, that hall hire is
  // the night's cost and the standing training rate is not charged on top of it.
  if (!cancelled && !hiredHall && club.finances.trainingCostPerWeek > 0) {
    addLedgerEntry(state, clubId, {
      date,
      description: 'Training pitch and floodlights',
      category: 'pitch-hire',
      amount: -club.finances.trainingCostPerWeek,
    });
  }

  // A session with no floodlights in the winter is a shorter one.
  let minutes = TRAINING_LENGTH_MINUTES[plan.length];
  let shortened: string | null = null;
  const month = monthOf(date);
  if (!cancelled && !ground?.hasFloodlights && (month === 11 || month <= 1) && plan.length !== 'short') {
    minutes = Math.max(45, minutes - 20);
    shortened = 'We lost the light and finished early.';
  }

  const session: TrainingSession = {
    id: `training_${state.season.id}_${clubId}_${matchday}`,
    clubId,
    matchday,
    date,
    length: plan.length,
    minutes: cancelled ? 0 : minutes,
    blocks: [...plan.blocks],
    venueName: cancelled ? usedVenueName : usedVenueName,
    indoor,
    weather: conditions.weather,
    pitch: indoor ? 'excellent' : conditions.pitch,
    temperatureC: conditions.temperatureC,
    shortened,
    cancelled,
    cancelReason,
    attended: cancelled ? 0 : attendees.length,
    doubtful,
    absent,
    expectedAttending: expectation.attending.length,
    attendance: isUserClub ? entries : [],
    coachName: coach.name,
    coachRole: coach.role,
    coachQuality: coach.quality,
    quality: 0,
    summary: '',
    observations: [],
    standouts: [],
    trialistIds: trialistsAttending,
    injuredIds: [],
    improvements: [],
    declines: [],
    familiarityGain: 0,
  };

  if (cancelled) {
    session.summary = cancelReason
      ? `No session this week: ${cancelReason}.`
      : 'No session this week.';
    if (isUserClub) {
      events.push(
        createEvent(state, {
          type: 'training',
          importance: 1,
          clubIds: [clubId],
          data: {
            headline: 'Training cancelled',
            body: session.summary,
          },
        }),
      );
    }
    recordSession(state, session);
    return { events, session, messages: isUserClub ? [session.summary] : [] };
  }

  // --- The evening itself ------------------------------------------------------
  const minutesByBlock = sessionBlockMinutes(plan.blocks, minutes);
  const attendanceRatio = club.squadIds.length > 0 ? attendees.length / club.squadIds.length : 0;
  const cohesion = clubCohesionValue(state, clubId);
  const squadPlayers = attendees.map((id) => state.people[id]).filter(isPlayer);
  const meanMorale = squadPlayers.length > 0 ? squadPlayers.reduce((sum, p) => sum + p.morale, 0) / squadPlayers.length : 60;
  const pitchAdj = session.pitch === 'excellent' ? 6 : session.pitch === 'good' ? 3 : session.pitch === 'worn' ? -2 : session.pitch === 'muddy' ? -6 : -12;
  const weatherAdj = WEATHER_EFFECT[conditions.weather] ?? 0;
  const warmUp = plan.blocks.includes('warm-up');

  let quality = 50;
  quality += (attendanceRatio - 0.72) * 42;
  quality += (coach.quality - 0.5) * 20;
  quality += pitchAdj + weatherAdj;
  quality += ((meanMorale - 60) / 40) * 7;
  quality += (cohesion - 0.5) * 12;
  quality += warmUp ? 4 : -5;
  quality += plan.length === 'long' ? 2 : plan.length === 'short' ? -1 : 0;
  quality += indoor && ground?.surface === '3G' ? 2 : 0;
  quality += rng.gaussian(0, 6);
  // Belt and braces: a session always has a readable quality, whatever the
  // inputs (an odd coach record, a state built by a test) looked like.
  if (!Number.isFinite(quality)) quality = 50;
  quality = Math.max(8, Math.min(96, Math.round(quality)));
  session.quality = quality;

  const qualityFactor = 0.35 + quality / 100;
  const minutesFactor = minutes / 90;
  const observations: string[] = [];
  const standouts: TrainingStandout[] = [];

  if (coach.personId !== club.managerId && coach.personId) {
    observations.push(`${coach.name} took the session.`);
  }

  // Somebody was at five-a-side instead. He keeps his legs ticking over, and he
  // runs the same risk of turning an ankle on a caged pitch as he does on ours.
  for (const personId of fiveASideIds) {
    const person = state.people[personId];
    if (!isPlayer(person)) continue;
    const roll = stream(state.seed, 'five-a-side', personId, date);
    if (!roll.chance(0.045 + person.attributes.hidden.injurySusceptibility / 400)) continue;
    const daysOut = roll.int(4, 14);
    person.injury = {
      description: roll.pick(['a turned ankle', 'a dead leg', 'a sore knee']),
      severity: 'knock',
      daysOut,
      occurredOn: date,
    };
    person.availability = {
      status: 'unavailable',
      reason: 'injury',
      note: `Out with ${person.injury.description}`,
      until: addDays(date, daysOut),
      discoveredLate: false,
    };
    if (isUserClub) {
      observations.push(
        `${person.firstName} ${person.surname} picked up ${person.injury.description} at five-a-side — he is a doubt for Sunday.`,
      );
    }
  }

  for (const personId of attendees) {
    const person = state.people[personId];
    if (!isPlayer(person)) continue;
    const player: Player = person;
    const isTrialist = trialistsAttending.includes(player.id);

    // Tired legs: the point of training, and the price of it.
    const staminaFactor = 0.6 + player.attributes.physical.stamina / 20;
    let load = 0;
    for (const [blockId, blockMinutes] of minutesByBlock) {
      load += blockMinutes * TRAINING_BLOCKS[blockId].load;
    }
    const fitnessCost = (load * 0.13) / staminaFactor;
    player.fitness = Math.max(20, Math.round((player.fitness - fitnessCost) * 10) / 10);

    // A good evening lifts the dressing room a little; a bad one drags.
    const personalityFactor = MORALE_PERSONALITY[player.personality] ?? 1;
    let moraleDelta = ((quality - 55) / 45) * 2.6 * personalityFactor;
    if (player.fitness < 45) moraleDelta -= 1.2;
    if (player.injury) moraleDelta -= 0.8;
    player.morale = Math.max(15, Math.min(99, Math.round((player.morale + moraleDelta) * 10) / 10));

    // What the evening taught him about how this team plays.
    const gained = gainSystemFamiliarity(state, player, plan.blocks, qualityFactor, minutesFactor, date);
    if (!isTrialist && Number.isFinite(gained)) session.familiarityGain += gained;

    // Positional work, for a lad being asked to learn somewhere else.
    const secondary = secondaryPositionFor(player);
    if (
      !isTrialist &&
      nudgePositionalFamiliarity(state, player, secondary, plan.blocks, qualityFactor, date) &&
      secondary &&
      isUserClub
    ) {
      observations.push(`${player.firstName} ${player.surname} looks more at home at ${POSITIONS[secondary].label.toLowerCase()}.`);
    }

    // The work accumulates; only sometimes does it show.
    if (!isTrialist) {
      accrueDevelopment(state, { player, blocks: plan.blocks, minutesByBlock, qualityFactor, date });
      const improvements = applyImprovements(state, player, date, qualityFactor, Math.max(0, Math.min(1, player.morale / 100)));
      for (const improvement of improvements) {
        session.improvements.push(improvement);
        if (isUserClub) {
          observations.push(`${player.firstName} ${player.surname} has come on — his ${improvement.label.toLowerCase()} is better than it was.`);
        }
      }
      // Age does its work in the same breath. A man past his peak loses a
      // little every week whatever the session was like, which is what stops
      // the world's football getting better every year for ever.
      for (const decline of applyDecline(state, player, date)) {
        session.declines.push(decline);
      }
    }

    // Bodies break. Not often, but it is the risk the manager is taking.
    if (session.injuredIds.length < 2 && trainingInjuryHappens(rng, player, plan.blocks, session)) {
      session.injuredIds.push(player.id);
    }
  }

  // --- Who stood out -----------------------------------------------------------
  pickStandouts(rng, squadPlayers, plan.blocks, quality, standouts);
  session.standouts = standouts;
  for (const standout of standouts) observations.push(standout.line);

  // --- The social side of a Thursday ------------------------------------------
  events.push(...trainingSocialEvents(state, rng, clubId, matchday, plan.blocks, quality, attendees, observations, date));

  // --- Trialists get their look (the existing trial machinery, not a new one) ---
  if (trialistsAttending.length > 0) {
    const trial = runTrialSession(state);
    events.push(...trial.events);
    for (const outcome of trial.outcomes) {
      if (outcome.attended) observations.push(`Trialist: ${outcome.summary}`);
    }
  }

  // --- Tired legs, and what the manager says about it --------------------------
  if (session.injuredIds.length > 0) {
    for (const injuredId of session.injuredIds) {
      const person = state.people[injuredId];
      if (!isPlayer(person)) continue;
      observations.push(`${person.firstName} ${person.surname} pulled up with ${person.injury?.description ?? 'a knock'} — he is a doubt for Sunday.`);
    }
  }

  if (attendees.length < expectation.attending.length * 0.7) {
    observations.push(
      `Only ${attendees.length} of the ${expectation.attending.length} you were expecting made it.`,
    );
  }

  const familiarityNow = clubSystemFamiliarity(state, clubId);
  if (!indoor && session.pitch === 'muddy') {
    observations.push('Heavy going underfoot — the ball was bobbling all night.');
  }
  if (familiarityNow >= 0.72) {
    observations.push('The shape is second nature to most of them now.');
  } else if (familiarityNow <= 0.42) {
    observations.push('Still a lot of standing around asking who goes where.');
  }

  session.observations = observations.slice(0, 14);
  session.summary = writeSessionSummary(session, attendees.length, club.squadIds.length);

  recordSession(state, session);

  if (isUserClub) {
    events.push(
      createEvent(state, {
        type: 'training',
        importance: 1,
        clubIds: [clubId],
        data: {
          headline: `Training: ${session.observations[0] ?? session.summary}`,
          body: [session.summary, ...session.observations].join(' '),
        },
      }),
    );
    for (const improvement of session.improvements) {
      const person = state.people[improvement.personId];
      events.push(
        createEvent(state, {
          type: 'development',
          importance: 1,
          clubIds: [clubId],
          personIds: [improvement.personId],
          data: {
            headline: `${person ? `${person.firstName} ${person.surname}` : 'A player'} is improving`,
            body: `Months of Thursday nights are showing: his ${improvement.label.toLowerCase()} is better than it was.`,
          },
        }),
      );
    }
  }

  return { events, session, messages: isUserClub ? [session.summary] : [] };
}

/**
 * Run every club's session for a matchday, once each. The world trains whether
 * or not the manager is looking — his own club gets the detail, everybody else
 * gets the same physics and a couple of numbers.
 */
export function ensureTrainingConducted(
  state: GameState,
  matchday: number,
  clubIds?: readonly ClubId[],
): TrainingOutcome {
  const result: TrainingOutcome = { events: [], session: null, messages: [] };
  // Every club in the pyramid, not just the first competition's. Taking the
  // first division here trained the top of the ladder and left the other two
  // silently frozen: their men never improved, never tired, and never appeared
  // in a session. A club in Division Three has a Thursday night too.
  const ids = clubIds ?? leagueClubIds(state);
  for (const clubId of ids) {
    const outcome = conductTraining(state, clubId, matchday);
    result.events.push(...outcome.events);
    if (clubId === state.userClubId) {
      result.session = outcome.session;
      result.messages.push(...outcome.messages);
    }
  }
  return result;
}

/** The manager's own club, just before a match kicks off. */
export function ensureClubTrained(state: GameState, clubId: ClubId, matchday = currentSessionKey(state)): TrainingOutcome {
  return conductTraining(state, clubId, matchday);
}

function hallNameFor(state: GameState, clubId: ClubId): string {
  const club = state.clubs[clubId];
  const town = club ? state.world.towns[club.townId] : undefined;
  const caged = state.world.groundIds
    .map((id) => state.world.grounds[id])
    .find((ground) => ground && town && ground.townId === town.id && ground.surface === '3G');
  if (caged) return `${caged.name} (the caged pitch)`;
  return `${town?.name ?? 'The village'} Leisure Centre`;
}

function trialistIdsFor(state: GameState): PersonId[] {
  const recruitment = state.recruitment as { pendingTrialIds?: PersonId[] } | undefined;
  return recruitment?.pendingTrialIds ? [...recruitment.pendingTrialIds] : [];
}

const FIVE_A_SIDE_REASON = 'Playing five-a-side instead';

function trainingAbsenceReason(rng: ReturnType<typeof stream>): string {
  return rng.pick([
    'Working late',
    'On shift',
    'Kids in bed and no babysitter',
    'Car would not start',
    FIVE_A_SIDE_REASON,
    'Said he would come, did not',
    'Been on his feet all day',
    'Football is not the priority this week',
  ]);
}

function secondaryPositionFor(player: Player): PositionCode | null {
  const options = (Object.entries(player.positionalFamiliarity) as Array<[PositionCode, number]>)
    .filter(([position, value]) => position !== player.preferredPosition && value > 0 && value < 17)
    .sort((a, b) => b[1] - a[1]);
  return options[0]?.[0] ?? null;
}

function trainingInjuryHappens(
  rng: ReturnType<typeof stream>,
  player: Player,
  blocks: readonly TrainingBlockId[],
  session: TrainingSession,
): boolean {
  let chance = 0.0055;
  if (!blocks.includes('warm-up')) chance *= 1.9;
  if (blocks.includes('fitness')) chance *= 1.4;
  if (session.pitch === 'muddy') chance *= 1.35;
  if (session.pitch === 'frozen') chance *= 1.2;
  if (session.length === 'long') chance *= 1.25;
  if (player.fitness < 60) chance *= 1.6;
  if (player.injury) chance *= 2;
  chance *= 0.7 + player.attributes.hidden.injurySusceptibility / 12;
  chance *= 0.85 + player.age / 60;
  if (!rng.chance(chance)) return false;

  const severityRoll = rng.next();
  const detail =
    severityRoll < 0.62
      ? { description: rng.pick(['a tight hamstring', 'a rolled ankle', 'a knock on the knee', 'a tweaked groin']), severity: 'knock' as const, daysOut: rng.int(3, 9) }
      : severityRoll < 0.93
        ? { description: rng.pick(['a pulled hamstring', 'a twisted knee', 'a calf strain']), severity: 'minor' as const, daysOut: rng.int(10, 24) }
        : { description: rng.pick(['a bad ankle', 'a suspected break', 'a serious knee problem']), severity: 'serious' as const, daysOut: rng.int(45, 120) };

  player.injury = { description: detail.description, severity: detail.severity, daysOut: detail.daysOut, occurredOn: session.date };
  player.availability = {
    status: 'unavailable',
    reason: 'injury',
    note: `Out with ${detail.description}`,
    until: addDays(session.date, detail.daysOut),
    discoveredLate: false,
  };
  return true;
}

function pickStandouts(
  rng: ReturnType<typeof stream>,
  squad: readonly Player[],
  blocks: readonly TrainingBlockId[],
  quality: number,
  out: TrainingStandout[],
): void {
  if (squad.length === 0) return;
  const trained = squad.filter((player) => !player.injury);
  if (trained.length === 0) return;

  const shine = [...trained]
    .map((player) => ({
      player,
      score:
        player.form / 100 +
        player.morale / 200 +
        player.attributes.hidden.tacticalIntelligence / 60 +
        rng.next() * 0.5,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, rng.int(1, 2));

  for (const entry of shine) {
    out.push({ personId: entry.player.id, line: standoutLine(rng, entry.player, blocks, quality) });
  }

  // And somebody always has a night to forget.
  if (quality < 62 && rng.chance(0.35)) {
    const struggler = rng.pick(trained);
    if (!out.some((standout) => standout.personId === struggler.id)) {
      out.push({
        personId: struggler.id,
        line: `${struggler.firstName} ${struggler.surname} ${rng.pick(['never got going', 'looked heavy-legged', 'had a bit of a shocker'])} — ${rng.pick(['maybe a one-off', 'worth keeping an eye on'])}.`,
      });
    }
  }
}

function standoutLine(
  rng: ReturnType<typeof stream>,
  player: Player,
  blocks: readonly TrainingBlockId[],
  quality: number,
): string {
  const name = `${player.firstName} ${player.surname}`;
  const pool: string[] = [];
  if (blocks.includes('attacking')) pool.push(`${name} could not stop scoring — everything he hit went in`);
  if (blocks.includes('defending')) pool.push(`${name} did not lose a header all night`);
  if (blocks.includes('possession')) pool.push(`${name} kept the ball better than anyone out there`);
  if (blocks.includes('fitness')) pool.push(`${name} was still going at the end when others had stopped`);
  if (blocks.includes('tactical')) pool.push(`${name} was the one telling everybody else where to stand`);
  if (blocks.includes('set-pieces')) pool.push(`${name} whipped in a couple of corners that nobody wanted to defend`);
  if (blocks.includes('teamwork')) pool.push(`${name} was in the middle of everything, taking the mickey and keeping it moving`);
  if (pool.length === 0) pool.push(`${name} looked sharp`);
  if (quality >= 70) pool.push(`${name} was the best player on the pitch`);
  return rng.pick(pool);
}

/**
 * The social side of training, and it is deliberately rare: most Thursdays go
 * by without anybody's relationship changing. Something only happens when a
 * specific thing actually happened — a lad helped somebody else, an argument
 * boiled over, a new face started to fit in, or somebody missed it again.
 */
function trainingSocialEvents(
  state: GameState,
  rng: ReturnType<typeof stream>,
  clubId: ClubId,
  matchday: number,
  blocks: readonly TrainingBlockId[],
  quality: number,
  attendees: readonly PersonId[],
  observations: string[],
  date: string,
): GameEvent[] {
  const events: GameEvent[] = [];
  const club = state.clubs[clubId];
  if (!club) return events;
  const managerId = club.managerId;
  const isUserClub = clubId === state.userClubId;
  const present = attendees.filter((id) => isPlayer(state.people[id]));
  if (present.length < 4) return events;

  const report = (result: ReturnType<typeof applyRelationshipEvent>): void => {
    if (!result || !isUserClub) return;
    events.push(
      createEvent(state, {
        type: 'dressing-room',
        importance: result.importance,
        clubIds: [clubId],
        personIds: [result.relationship.personAId, result.relationship.personBId],
        data: { headline: result.headline, body: `${result.description}.` },
      }),
    );
  };

  // Somebody helped somebody with something. This is how a squad actually
  // becomes a squad.
  if (quality >= 60 && blocks.some((block) => block === 'set-pieces' || block === 'tactical' || block === 'teamwork')) {
    if (rng.chance(0.24)) {
      const helper = rng.pick(present);
      const helped = rng.pick(present.filter((id) => id !== helper));
      if (helped) {
        const helperName = personName(state, helper);
        const helpedName = personName(state, helped);
        const work = blocks.includes('set-pieces') ? 'the new set-piece routine' : blocks.includes('tactical') ? 'the new shape' : 'his touch';
        report(
          applyRelationshipEvent(state, {
            type: 'teammate-support',
            aId: helper,
            bId: helped,
            intensity: 0.7,
            date,
            clubId,
            detail: `went through ${work} with him afterwards`,
          }),
        );
        observations.push(`${helperName} spent extra time after the session helping ${helpedName} with ${work}.`);
      }
    }
  }

  // A bad night, and somebody gets it in the neck.
  if (quality <= 42 && managerId && rng.chance(0.3)) {
    const target = rng.pick(present.filter((id) => id !== managerId));
    if (target) {
      const name = personName(state, target);
      report(
        applyRelationshipEvent(state, {
          type: 'manager-criticism',
          aId: target,
          bId: managerId,
          intensity: 0.8,
          date,
          clubId,
          detail: 'in front of the rest of them',
        }),
      );
      observations.push(`${name} got both barrels during the session and did not take it well.`);
    }
  }

  // A new face in the middle of everything: somebody who arrived after the
  // season started, not the whole squad in pre-season.
  const newcomers = present.filter((id) => {
    const person = state.people[id];
    return (
      isPlayer(person) &&
      person.joinedClubOn > state.season.startDate &&
      weeksSince(person.joinedClubOn, date) <= 8
    );
  });
  if (newcomers.length > 0 && quality >= 55 && rng.chance(0.45)) {
    const newcomer = rng.pick(newcomers);
    const mate = rng.pick(present.filter((id) => id !== newcomer));
    if (mate) {
      const person = state.people[newcomer];
      report(
        applyRelationshipEvent(state, {
          type: 'teammate-support',
          aId: mate,
          bId: newcomer,
          intensity: 0.6,
          date,
          clubId,
          detail: 'showed him the ropes',
        }),
      );
      if (person) observations.push(`${person.firstName} ${person.surname} is settling in — he was in the middle of everything.`);
    }
  }

  // Missing it *again*: he was not here last week either, and the manager has
  // noticed. (One absence is life; two in a row is a pattern.)
  const lastWeek = sessionsFor(state, clubId).find((session) => session.matchday === matchday - 1);
  if (managerId && lastWeek) {
    const missedLastWeek = new Set(
      lastWeek.attendance.filter((entry) => entry.status === 'absent').map((entry) => entry.personId),
    );
    const repeated = club.squadIds.filter((id) => {
      if (attendees.includes(id) || !missedLastWeek.has(id)) return false;
      const person = state.people[id];
      if (!isPlayer(person)) return false;
      const relationship = getRelationship(state, id, managerId);
      const tension = relationship ? relationship.aToB.tension + relationship.bToA.tension : 0;
      return tension > 6;
    });
    if (repeated.length > 1 && rng.chance(0.4)) {
      const playerId = rng.pick(repeated);
      const name = personName(state, playerId);
      recordInteraction(state, {
        aId: playerId,
        bId: managerId,
        aToB: { trust: -2, tension: 2.5, loyalty: -1 },
        bToA: { respect: -1.5, trust: -1.5, tension: 1 },
        description: `${name} missed training again`,
        tone: 'negative',
        date,
        provenance: 'observed',
      });
      observations.push(`${name} was not there again — that is becoming a habit.`);
    }
  }

  return events;
}

function writeSessionSummary(session: TrainingSession, attended: number, squadSize: number): string {
  const lengthWords = session.minutes >= 115 ? 'two hours' : session.minutes >= 80 ? 'an hour and a half' : `about ${Math.round(session.minutes / 10) * 10} minutes`;
  const what = session.blocks.filter((block) => block !== 'warm-up').map((block) => TRAINING_BLOCKS[block].label.toLowerCase());
  const weatherPhrase = WEATHER_PHRASE[session.weather] ?? 'a grey evening';
  const quality = describeSessionQualityOpen(session.quality);
  const where = session.indoor ? `at ${session.venueName}` : `down at ${session.venueName}`;
  const list = what.length === 0 ? 'a warm-up and nothing else' : listWords(what);
  return `${attended} of the ${squadSize} turned up ${where} on ${formatDayMonth(session.date)} for ${lengthWords} of ${list}, in ${weatherPhrase}. ${quality}${
    session.shortened ? ` ${session.shortened}` : ''
  }`;
}

function listWords(items: readonly string[]): string {
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function describeSessionQualityOpen(quality: number): string {
  if (quality >= 78) return 'It was one of the best sessions of the season.';
  if (quality >= 64) return 'It was a good night’s work.';
  if (quality >= 50) return 'It was a decent enough session.';
  if (quality >= 36) return 'It was an ordinary sort of evening.';
  if (quality >= 22) return 'Not much got done.';
  return 'It was a waste of an evening.';
}

const WEATHER_EFFECT: Record<string, number> = {
  clear: 1,
  overcast: 0,
  windy: -2,
  'light-rain': -2,
  'heavy-rain': -4,
  cold: -2,
  frozen: -6,
};

const WEATHER_PHRASE: Record<string, string> = {
  clear: 'a dry, bright evening',
  overcast: 'a grey evening',
  windy: 'a wind blowing across the pitch',
  'light-rain': 'a bit of drizzle',
  'heavy-rain': 'proper rain',
  cold: 'a cold night',
  frozen: 'a heavy frost',
};

const MORALE_PERSONALITY: Record<string, number> = {
  Quiet: 0.8,
  'Laid back': 0.7,
  Confident: 1,
  Talkative: 1.05,
  Competitive: 1.15,
  'Wind-up merchant': 0.95,
  'Model pro': 1.15,
  'Hot-headed': 1.3,
  Joker: 1.1,
  'Reliable sort': 1,
};
