import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, PersonId, SeasonId } from '@/domain/ids';
import type { Club } from '@/domain/club';
import type { GameEvent } from '@/domain/news';
import { isOfficial, type Official } from '@/domain/person';
import { attitudeOf, attitudeToward } from '@/domain/relationship';
import {
  emptyGovernanceState,
  governanceStandingRank,
  type GovernanceConcern,
  type GovernanceEvent,
  type GovernanceEventKind,
  type GovernanceExpectation,
  type GovernanceStanding,
  type GovernanceState,
} from '@/domain/governance';
import { addLedgerEntry } from './finance';
import { nextId } from './ids';
import { createEvent } from './news';
import { completedMatchdays, leaguePosition } from './queries';
import { cupCompetitions, divisionOf, tierOf } from './pyramid';
import { applyRelationshipEvent, getRelationship, upsertRelationship } from './relationships';
import { stream } from './rng';
import { secretaryStore } from './secretary';

/**
 * The chairman's view of the club.
 *
 * The chairman is a real person with a real relationship to the manager, and
 * this is the small layer that lets him *use* it. It does not invent a hidden
 * approval percentage: expectations are read off the club's actual position,
 * concerns are read off its actual state, and the standing the committee takes
 * is a handful of words reviewed at the season boundary from persistent context.
 *
 * Everything it does runs through a system that already exists — the
 * relationship the chairman and the manager already have, the ledger the
 * treasurer already keeps, the calendar the fixtures already use, the history
 * the club already writes — and nothing here moves a match, a table or a
 * competition.
 */

export const GOVERNANCE = {
  /** A finish this many places below the club's standing starts to bite. */
  leagueSlack: 3,
  /** Consecutive seasons below expectation before the committee's patience thins. */
  warningSeasons: 2,
  /** ...and before the manager is genuinely under pressure. */
  pressureSeasons: 3,
  /** A balance below this is a real financial worry, not a bad week. */
  financialWorry: -750,
  /** Dressing-room unrest this widespread is a stability concern. */
  unrestCount: 3,
} as const;

export function governanceStore(state: GameState): GovernanceState {
  if (!state.governance) state.governance = emptyGovernanceState();
  if (!Array.isArray(state.governance.events)) state.governance.events = [];
  if (!Array.isArray(state.governance.reacted)) state.governance.reacted = [];
  return state.governance;
}

/* ------------------------------------------------------------------------ *\
 * The man himself
 * ------------------------------------------------------------------------ */

export function clubChairman(state: GameState, clubId: ClubId = state.userClubId): Official | null {
  const id = state.clubs[clubId]?.chairmanId ?? null;
  const person = id ? state.people[id] : undefined;
  return isOfficial(person) ? person : null;
}

/* ------------------------------------------------------------------------ *\
 * Expectations, read off the club as it stands
 * ------------------------------------------------------------------------ */

/** Where a club's reputation says it should finish, out of its own division. */
export function expectedLeagueRank(state: GameState, clubId: ClubId): number {
  const division = divisionOf(state, clubId);
  const ids = division?.clubIds ?? [];
  const order = ids
    .map((id) => state.clubs[id])
    .filter((club): club is Club => !!club)
    .sort((a, b) => b.reputation - a.reputation || a.id.localeCompare(b.id));
  const index = order.findIndex((club) => club.id === clubId);
  return index < 0 ? Math.max(1, Math.ceil(order.length / 2)) : index + 1;
}

function squadTension(state: GameState, clubId: ClubId): number {
  const club = state.clubs[clubId];
  const managerId = club?.managerId;
  if (!club || !managerId) return 0;
  let unrest = 0;
  for (const playerId of club.squadIds) {
    const relationship = getRelationship(state, managerId, playerId);
    if (!relationship) continue;
    if ((attitudeOf(relationship, managerId)?.tension ?? 0) >= 60) unrest += 1;
  }
  return unrest;
}

/**
 * What the committee expects this season, judged from the club's actual position.
 *
 * Nothing is stored: a promotion, a relegation, a transfer window or a new
 * division changes expectations the moment the state changes, and a save that
 * changes hands reads the expectations its position deserves.
 */
export function clubExpectations(state: GameState, clubId: ClubId = state.userClubId): GovernanceExpectation[] {
  const club = state.clubs[clubId];
  if (!club) return [];
  const expectations: GovernanceExpectation[] = [];

  // League: finish around where the club's standing says it belongs.
  const expected = expectedLeagueRank(state, clubId);
  const position = leaguePosition(state, clubId);
  const played = completedMatchdays(state);
  const leagueStatus =
    position === null || played === 0
      ? 'pending'
      : position <= expected
        ? 'met'
        : position <= expected + GOVERNANCE.leagueSlack
          ? 'at-risk'
          : 'failed';
  expectations.push({
    key: 'league',
    label: 'League performance',
    detail: `A club of this standing should be around ${ordinal(expected)}.`,
    status: leagueStatus,
  });

  // Finances: keep the club out of the red.
  const admin = club.finances.administrationSeasons ?? 0;
  const financeStatus =
    admin > 0 || club.finances.balance < GOVERNANCE.financialWorry
      ? 'failed'
      : club.finances.balance < 0
        ? 'at-risk'
        : 'met';
  expectations.push({
    key: 'finances',
    label: 'Staying solvent',
    detail: 'The committee can live with a lean month, not a club in the red.',
    status: financeStatus,
  });

  // Stability: enough players and a settled dressing room.
  const size = club.squadIds.length;
  const unrest = squadTension(state, clubId);
  const stabilityStatus = size < 9 || unrest >= GOVERNANCE.unrestCount ? 'failed' : unrest > 0 ? 'at-risk' : 'met';
  expectations.push({
    key: 'stability',
    label: 'A settled club',
    detail: 'Enough bodies, and a dressing room that is not at his throat.',
    status: stabilityStatus,
  });

  // Squad: a workable number of registered players.
  const squadStatus = size >= 14 ? 'met' : size >= 11 ? 'at-risk' : 'failed';
  expectations.push({
    key: 'squad',
    label: 'Enough players',
    detail: 'A Sunday club needs a squad, not a scramble.',
    status: squadStatus,
  });

  // Reputation: not letting the club's standing slide within its division.
  const division = divisionOf(state, clubId);
  const divisionClubs = (division?.clubIds ?? []).map((id) => state.clubs[id]).filter((c): c is Club => !!c);
  const average = divisionClubs.length
    ? divisionClubs.reduce((sum, c) => sum + c.reputation, 0) / divisionClubs.length
    : club.reputation;
  const gap = club.reputation - average;
  expectations.push({
    key: 'reputation',
    label: 'Club standing',
    detail: 'The club should hold its place in the local game.',
    status: gap >= -8 ? 'met' : gap >= -18 ? 'at-risk' : 'failed',
  });

  // Cup: only where the club has actually played a cup tie.
  const cups = cupCompetitions(state);
  const cupIds = new Set(cups.map((cup) => cup.id));
  const cupMatches = Object.values(state.matches).filter(
    (match) =>
      cupIds.has(match.competitionId) &&
      match.played &&
      (match.homeClubId === clubId || match.awayClubId === clubId),
  );
  if (cupMatches.length > 0) {
    const wins = cupMatches.filter((match) => {
      const mine = match.homeClubId === clubId ? match.result?.homeGoals ?? 0 : match.result?.awayGoals ?? 0;
      const theirs = match.homeClubId === clubId ? match.result?.awayGoals ?? 0 : match.result?.homeGoals ?? 0;
      return mine > theirs;
    }).length;
    expectations.push({
      key: 'cup',
      label: 'A cup run',
      detail: 'A tie or two on a Saturday is good for the club.',
      status: wins > 0 ? 'met' : 'at-risk',
    });
  }

  return expectations;
}

function ordinal(value: number): string {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

/**
 * What is currently worrying the chairman.
 *
 * Derived from the expectations and the manager's own relationship with the
 * chairman, so the concerns in front of the manager are always the ones the club
 * actually has. Nothing is stored and nothing is repeated: this is a reading.
 */
export function governanceConcerns(state: GameState, clubId: ClubId = state.userClubId): GovernanceConcern[] {
  const club = state.clubs[clubId];
  if (!club) return [];
  const concerns: GovernanceConcern[] = [];

  for (const expectation of clubExpectations(state, clubId)) {
    if (expectation.status !== 'at-risk' && expectation.status !== 'failed') continue;
    concerns.push({
      key: `expectation:${expectation.key}`,
      kind:
        expectation.key === 'finances'
          ? 'finances'
          : expectation.key === 'stability'
            ? 'stability'
            : expectation.key === 'reputation'
              ? 'reputation'
              : expectation.key === 'cup'
                ? 'results'
                : 'results',
      severity: expectation.status === 'failed' ? 3 : 1,
      text: `${expectation.label}: ${expectation.detail}`,
    });
  }

  const managerId = club.managerId;
  const chairman = clubChairman(state, clubId);
  if (managerId && chairman) {
    const relationship = getRelationship(state, managerId, chairman.id);
    const chairmanView = relationship ? attitudeOf(relationship, chairman.id) : null;
    if (chairmanView && chairmanView.tension >= 55) {
      concerns.push({
        key: 'relationship:tension',
        kind: 'relationship',
        severity: chairmanView.tension >= 72 ? 3 : 2,
        text: 'The chairman is not happy with how things are being handled.',
      });
    }
  }

  return concerns;
}

/* ------------------------------------------------------------------------ *\
 * Reactions
 * ------------------------------------------------------------------------ */

interface GovernanceEventSeed {
  key: string;
  seasonLabel: string;
  kind: GovernanceEventKind;
  importance: 1 | 2 | 3;
  title: string;
  detail: string;
  standing: GovernanceStanding;
  date?: ISODate;
  personIds?: PersonId[];
}

function recordGovernance(state: GameState, clubId: ClubId, seed: GovernanceEventSeed): GovernanceEvent | null {
  const store = governanceStore(state);
  if (store.events.some((event) => event.key === seed.key)) return null;
  const event: GovernanceEvent = {
    id: nextId(state, 'gov'),
    key: seed.key,
    date: seed.date ?? state.date,
    seasonLabel: seed.seasonLabel,
    kind: seed.kind,
    importance: seed.importance,
    title: seed.title,
    detail: seed.detail,
    standing: seed.standing,
    clubIds: [clubId],
    personIds: seed.personIds ?? [],
  };
  store.events.unshift(event);
  if (store.events.length > 120) store.events.length = 120;
  return event;
}

function markReacted(state: GameState, key: string): void {
  const store = governanceStore(state);
  if (!store.reacted.includes(key)) store.reacted.push(key);
  if (store.reacted.length > 200) store.reacted.splice(0, store.reacted.length - 200);
}

/** How many of the club's recent seasons have fallen below expectation. */
export function failureStreak(state: GameState, clubId: ClubId): number {
  const club = state.clubs[clubId];
  if (!club) return 0;
  const expected = expectedLeagueRank(state, clubId);
  let streak = 0;
  for (const record of club.history.seasons) {
    if (record.finalPosition === null) break;
    if (record.finalPosition > expected + GOVERNANCE.leagueSlack) streak += 1;
    else break;
  }
  return streak;
}

export interface GovernanceContext {
  seasonId: SeasonId;
  seasonLabel: string;
  seasonStart: ISODate;
  /** The season just finished — the one the committee is judging. */
  previousSeasonId: SeasonId;
  previousSeasonLabel: string;
}

export interface GovernanceOutcome {
  events: GameEvent[];
  standing: GovernanceStanding;
  recorded: GovernanceEvent[];
}

/**
 * The season review.
 *
 * Called once at the boundary, after the season has been archived and the
 * managers' market has turned. It reads the finish, the books, the chairman's
 * relationship with the manager and the chairman's own patience, and settles on
 * a standing. It then says so once — through the relationship that already
 * exists, a governance record for the notable ones, and the club's own history
 * for the serious ones.
 *
 * With no chairman, or no manager, it does nothing at all: a club with nobody in
 * the chair is a club with nobody to take a view.
 */
export function runGovernance(
  state: GameState,
  context: GovernanceContext,
  clubId: ClubId = state.userClubId,
): GovernanceOutcome {
  const out: GovernanceOutcome = { events: [], standing: governanceStore(state).standing, recorded: [] };
  const club = state.clubs[clubId];
  if (!club) return out;
  const chairman = clubChairman(state, clubId);
  const managerId = club.managerId;
  if (!chairman || !managerId) return out;

  const previous = club.history.seasons.find((record) => record.seasonId === context.previousSeasonId);
  const finish = previous?.finalPosition ?? null;
  const expected = expectedLeagueRank(state, clubId);
  const performance = finish !== null ? finish - expected : 0; // positive is worse
  const balance = club.finances.balance;
  const admin = club.finances.administrationSeasons ?? 0;
  const streak = failureStreak(state, clubId);

  // The chairman and the manager work together, so the relationship is theirs to
  // have even before either says a word to the other. This is the one relationship
  // system, not a second one.
  const relationship =
    getRelationship(state, managerId, chairman.id) ??
    upsertRelationship(state, {
      aId: chairman.id,
      bId: managerId,
      origin: 'club-committee',
      context: `Chairman at ${club.identity.shortName}`,
      date: state.date,
    });
  const chairmanView = attitudeOf(relationship, chairman.id);

  let score = 0;
  score += Math.max(-6, Math.min(8, performance));
  if (balance < 0) score += 3 + Math.min(3, admin);
  if (chairmanView) {
    score += (60 - chairmanView.trust) / 12;
    score += chairmanView.tension / 15;
    score -= (chairmanView.respect - 50) / 20;
  }
  score -= (chairman.patience - 11) / 4;

  let standing: GovernanceStanding =
    score <= -3 ? 'support' : score <= 0.5 ? 'content' : score <= 3 ? 'concern' : score <= 6 ? 'warning' : 'pressure';
  // Persistent failure raises the floor: two bad seasons is never a quiet word,
  // and the committee cannot stay comfortable through a third.
  if (streak >= GOVERNANCE.pressureSeasons && governanceStandingRank(standing) < governanceStandingRank('pressure')) {
    standing = 'pressure';
  } else if (streak >= GOVERNANCE.warningSeasons && governanceStandingRank(standing) < governanceStandingRank('warning')) {
    standing = 'warning';
  }

  const store = governanceStore(state);
  store.standing = standing;
  store.standingSeasonId = context.previousSeasonId;

  // Say it once, through the relationship the chairman actually has.
  if (standing === 'support') {
    applyRelationshipEvent(state, { type: 'chairman-praise', aId: chairman.id, bId: managerId, intensity: 1 });
  } else if (standing === 'concern') {
    applyRelationshipEvent(state, { type: 'chairman-concern', aId: chairman.id, bId: managerId, intensity: 0.6 });
  } else if (standing === 'warning') {
    applyRelationshipEvent(state, { type: 'chairman-concern', aId: chairman.id, bId: managerId, intensity: 1 });
  } else if (standing === 'pressure') {
    applyRelationshipEvent(state, { type: 'chairman-concern', aId: chairman.id, bId: managerId, intensity: 1.4 });
  }

  const summary = `${club.identity.name} finished ${finish === null ? 'the season' : `${ordinal(finish)}`} where the committee looked for ${ordinal(expected)}.`;
  const kinds: Record<GovernanceStanding, GovernanceEventKind> = {
    support: 'praise',
    content: 'concern',
    concern: 'concern',
    warning: 'warning',
    pressure: 'formal-pressure',
    dismissal: 'dismissal',
  };
  if (standing !== 'content') {
    const importance: 1 | 2 | 3 = standing === 'support' ? 1 : standing === 'concern' ? 1 : standing === 'warning' ? 2 : 3;
    const titles: Record<GovernanceStanding, string> = {
      support: 'The chairman is pleased',
      content: 'The chairman is content',
      concern: 'The chairman has concerns',
      warning: 'The chairman has warned you',
      pressure: 'You are under pressure',
      dismissal: 'The committee has lost faith',
    };
    const recorded = recordGovernance(state, clubId, {
      key: `standing:${context.previousSeasonId}`,
      seasonLabel: context.previousSeasonLabel,
      kind: kinds[standing],
      importance,
      title: titles[standing],
      detail: summary,
      standing,
      personIds: [chairman.id, managerId],
    });
    if (recorded) out.recorded.push(recorded);
    const headline = standing === 'support' ? 'The chairman backs you' : standing === 'concern' ? 'The chairman airs a concern' : titles[standing];
    out.events.push(
      createEvent(state, {
        type: 'club-event',
        importance,
        clubIds: [clubId],
        personIds: [chairman.id, managerId],
        data: {
          headline,
          body: `${summary}${standing === 'pressure' ? ' The committee has made its position clear.' : ''}`,
        },
      }),
    );
    // Only the serious ones belong in the club's history: a quiet word is a
    // conversation, not an archive entry.
    if (governanceStandingRank(standing) >= governanceStandingRank('warning')) {
      club.history.notableEvents.unshift({
        date: context.seasonStart,
        seasonLabel: context.previousSeasonLabel,
        description:
          standing === 'pressure'
            ? 'The committee put the manager under formal pressure.'
            : 'The manager was warned about the club’s direction.',
        importance: standing === 'pressure' ? 3 : 2,
      });
    }
  }

  // The AGM: use the secretary's own AGM item rather than inventing a second one.
  const agmKey = `admin:club-agm:${context.previousSeasonId}`;
  const agm = secretaryStore(state).events.find((event) => event.key === agmKey);
  const recordedAgm = recordGovernance(state, clubId, {
    key: `agm:${context.previousSeasonId}`,
    seasonLabel: context.previousSeasonLabel,
    kind: 'agm',
    importance: 1,
    title: 'Club AGM',
    detail: agm
      ? `The committee met to sign off the accounts and the season. ${agm.detail}`
      : 'The committee met to sign off the accounts and the season.',
    standing,
    date: agm?.date ?? context.seasonStart,
    personIds: [chairman.id, managerId],
  });
  if (recordedAgm) out.recorded.push(recordedAgm);

  out.standing = standing;
  return out;
}

/* ------------------------------------------------------------------------ *\
 * Pressure, and the brink
 * ------------------------------------------------------------------------ */

/**
 * Whether the committee has the grounds to part ways.
 *
 * Never one result and never one season: it takes a sustained run below
 * expectation, or a club that has spent years in the red. This only answers the
 * question — dismissing the manager is a career decision, applied elsewhere.
 */
export function governanceCanDismiss(state: GameState, clubId: ClubId = state.userClubId): boolean {
  const club = state.clubs[clubId];
  if (!club) return false;
  if (governanceStore(state).standing !== 'pressure') return false;
  const admin = club.finances.administrationSeasons ?? 0;
  return failureStreak(state, clubId) >= GOVERNANCE.pressureSeasons || admin >= 3;
}

/** Represent the decision to part ways. Sets the standing and records it once. */
export function applyGovernanceDismissal(state: GameState, clubId: ClubId = state.userClubId): GovernanceEvent | null {
  const club = state.clubs[clubId];
  const managerId = club?.managerId;
  const chairman = clubChairman(state, clubId);
  if (!club || !managerId || !chairman) return null;
  const store = governanceStore(state);
  store.standing = 'dismissal';
  const recorded = recordGovernance(state, clubId, {
    key: `dismissal:${state.season.id}`,
    seasonLabel: state.season.label,
    kind: 'dismissal',
    importance: 3,
    title: 'The committee parted ways with the manager',
    detail: 'After a sustained run below expectation, the committee decided a change was needed.',
    standing: 'dismissal',
    personIds: [chairman.id, managerId],
  });
  club.history.notableEvents.unshift({
    date: state.date,
    seasonLabel: state.season.label,
    description: 'The committee parted ways with the manager.',
    importance: 3,
  });
  return recorded;
}

/* ------------------------------------------------------------------------ *\
 * Rare, meaningful intervention
 * ------------------------------------------------------------------------ */

export interface BackingResult {
  granted: boolean;
  amount: number;
  reason: 'granted' | 'no-need' | 'refused' | 'no-chairman' | 'already-asked';
}

/**
 * Ask the chairman to dig the club out of the red.
 *
 * Deliberately narrow. It only answers when the club is actually in debt and
 * only once a season, and what he will put in is bounded by the debt and by the
 * club's own scale — there is no free money here, only a chairman deciding
 * whether the man in the dugout is worth backing. Whether he does is read from
 * his relationship with the manager and his own patience, through the ledger the
 * treasurer already keeps.
 */
export function requestChairmanBacking(
  state: GameState,
  clubId: ClubId = state.userClubId,
  amount?: number,
): BackingResult {
  const club = state.clubs[clubId];
  const chairman = clubChairman(state, clubId);
  const managerId = club?.managerId ?? null;
  if (!club || !chairman || !managerId) return { granted: false, amount: 0, reason: 'no-chairman' };
  if (club.finances.balance >= 0) return { granted: false, amount: 0, reason: 'no-need' };

  const key = `backing:${state.season.id}`;
  if (governanceStore(state).reacted.includes(key)) return { granted: false, amount: 0, reason: 'already-asked' };

  const owed = Math.abs(club.finances.balance);
  const ceiling = Math.max(150, Math.round(club.reputation * 12));
  const grantable = Math.max(50, Math.min(amount ?? owed, owed, ceiling));

  const relationship = getRelationship(state, managerId, chairman.id);
  const chairmanView = relationship ? attitudeOf(relationship, chairman.id) : null;
  const trust = chairmanView?.trust ?? 45;
  const respect = chairmanView?.respect ?? 50;
  const rng = stream(state.seed, 'chairman-backing', state.season.id, clubId);
  const chance = Math.min(0.85, 0.2 + trust / 250 + respect / 300 + chairman.patience / 120);

  markReacted(state, key);
  if (!rng.chance(chance)) {
    recordGovernance(state, clubId, {
      key: `refusal:${state.season.id}`,
      seasonLabel: state.season.label,
      kind: 'refusal',
      importance: 2,
      title: 'The chairman turned down a request',
      detail: 'He was asked to help the club out of the red and said no.',
      standing: governanceStore(state).standing,
      personIds: [chairman.id, managerId],
    });
    applyRelationshipEvent(state, { type: 'chairman-concern', aId: chairman.id, bId: managerId, intensity: 0.5 });
    return { granted: false, amount: 0, reason: 'refused' };
  }

  addLedgerEntry(state, clubId, {
    date: state.date,
    description: 'Chairman’s emergency backing',
    category: 'other',
    amount: grantable,
  });
  recordGovernance(state, clubId, {
    key: `backing:${state.season.id}`,
    seasonLabel: state.season.label,
    kind: 'backing',
    importance: 2,
    title: 'The chairman put money in',
    detail: `He put £${Math.round(grantable)} into the club to keep it afloat.`,
    standing: governanceStore(state).standing,
    personIds: [chairman.id, managerId],
  });
  applyRelationshipEvent(state, { type: 'chairman-praise', aId: chairman.id, bId: managerId, intensity: 1.5 });
  return { granted: true, amount: grantable, reason: 'granted' };
}

/* ------------------------------------------------------------------------ *\
 * Reading it
 * ------------------------------------------------------------------------ */

export interface GovernanceSummary {
  chairman: Official | null;
  chairmanName: string | null;
  /** How the chairman feels about the manager, in words. */
  relationship: string | null;
  standing: GovernanceStanding;
  expectations: GovernanceExpectation[];
  concerns: GovernanceConcern[];
  events: GovernanceEvent[];
  canDismiss: boolean;
}

export function governanceSummary(state: GameState, clubId: ClubId = state.userClubId): GovernanceSummary {
  const club = state.clubs[clubId];
  const chairman = clubChairman(state, clubId);
  const managerId = club?.managerId ?? null;
  let relationship: string | null = null;
  if (chairman && managerId) {
    const record = getRelationship(state, managerId, chairman.id);
    const view = record ? attitudeToward(record, managerId) : null;
    relationship = view ? summarise(view) : null;
  }
  return {
    chairman,
    chairmanName: chairman ? `${chairman.firstName} ${chairman.surname}` : null,
    relationship,
    standing: governanceStore(state).standing,
    expectations: clubExpectations(state, clubId),
    concerns: governanceConcerns(state, clubId),
    events: [...governanceStore(state).events],
    canDismiss: governanceCanDismiss(state, clubId),
  };
}

/** A short label for an attitude, without dragging the UI into the domain. */
function summarise(attitude: { friendship: number; respect: number; trust: number; tension: number }): string {
  const positive = attitude.friendship * 0.5 + attitude.trust * 0.3 + attitude.respect * 0.2;
  const balance = positive - attitude.tension * 0.8;
  if (attitude.tension >= 66) return 'Strained';
  if (balance >= 62) return 'Good relationship';
  if (balance >= 46) return 'Gets on fine';
  if (balance >= 34) return 'Cool';
  return 'Little time for you';
}

/** The tier the club plays in, exposed for the UI without importing the pyramid. */
export function governanceTier(state: GameState, clubId: ClubId = state.userClubId): number | null {
  return tierOf(state, clubId);
}
