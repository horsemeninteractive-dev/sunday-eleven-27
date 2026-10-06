import type { ClubId, ISODate, PersonId } from './ids';

/**
 * Club governance.
 *
 * The chairman is a real person with a view of how the club is being run. This
 * is the small layer that gives him one: what he expects, what worries him, and
 * how he acts on it — without inventing a hidden approval score or turning every
 * match into a referendum.
 *
 * Three ideas keep it honest:
 *
 *  - **Expectations are derived, not stored.** A club's expectations are read
 *    off its reputation, its division, its books, its squad and the season so
 *    far. Nothing drifts, nothing needs syncing, and a save that changes hands
 *    wakes up with the expectations its position deserves.
 *  - **Standing is a handful of words, not a percentage.** *Support*, *content*,
 *    *concern*, *warning*, *pressure* — a discrete position the committee has
 *    taken, reviewed at the season boundary from persistent context rather than
 *    from one result.
 *  - **Reactions go through the relationship the chairman and the manager
 *    already have.** There is one relationship system in this game and this is
 *    not a second one.
 */

/**
 * How the committee currently regards the manager.
 *
 * Ordered, so "worse than" is a well-defined question. `dismissal` exists as the
 * end of the ladder the system *can* reach; it is never reached on one bad
 * result, and nothing here removes the manager — the manager's own career
 * decision is a separate matter.
 */
export type GovernanceStanding =
  | 'support'
  | 'content'
  | 'concern'
  | 'warning'
  | 'pressure'
  | 'dismissal';

export const GOVERNANCE_STANDING_ORDER: GovernanceStanding[] = [
  'support',
  'content',
  'concern',
  'warning',
  'pressure',
  'dismissal',
];

export const GOVERNANCE_STANDING_LABEL: Record<GovernanceStanding, string> = {
  support: 'Behind you',
  content: 'Content',
  concern: 'Concerned',
  warning: 'Warning',
  pressure: 'Under pressure',
  dismissal: 'On the brink',
};

export function governanceStandingRank(standing: GovernanceStanding): number {
  return GOVERNANCE_STANDING_ORDER.indexOf(standing);
}

/** What the committee expects of the manager this season. */
export type ExpectationKey =
  /** League performance against the club's standing. */
  | 'league'
  /** Keeping the club solvent. */
  | 'finances'
  /** A settled squad and dressing room. */
  | 'stability'
  /** Enough players, and the right ones. */
  | 'squad'
  /** Not letting the club's standing slide. */
  | 'reputation'
  /** A cup run worth having, where the club is in a cup. */
  | 'cup';

export type ExpectationStatus =
  /** Not decided yet — the season has not produced the evidence. */
  | 'pending'
  | 'met'
  | 'at-risk'
  | 'failed';

export interface GovernanceExpectation {
  key: ExpectationKey;
  label: string;
  detail: string;
  status: ExpectationStatus;
}

/** Where a worry came from, for the UI to group and for tests to assert on. */
export type ConcernKind =
  | 'results'
  | 'finances'
  | 'stability'
  | 'discipline'
  | 'reputation'
  | 'relationship';

export interface GovernanceConcern {
  key: string;
  kind: ConcernKind;
  severity: 1 | 2 | 3;
  text: string;
}

export type GovernanceEventKind =
  | 'praise'
  | 'concern'
  | 'warning'
  | 'formal-pressure'
  | 'agm'
  | 'decision'
  | 'backing'
  | 'refusal'
  | 'dismissal';

/** One significant thing the committee did. Only the notable ones are recorded. */
export interface GovernanceEvent {
  id: string;
  key: string;
  date: ISODate;
  seasonLabel: string;
  kind: GovernanceEventKind;
  importance: 1 | 2 | 3;
  title: string;
  detail: string;
  standing: GovernanceStanding;
  clubIds: ClubId[];
  personIds: PersonId[];
}

/**
 * The governance record.
 *
 * Kept deliberately small: the standing the committee last took, the season it
 * took it in, the notable events, and the reaction keys already fired (so one bad
 * month is one warning, not a warning every week).
 */
export interface GovernanceState {
  standing: GovernanceStanding;
  standingSeasonId: string | null;
  events: GovernanceEvent[];
  reacted: string[];
}

export function emptyGovernanceState(): GovernanceState {
  return { standing: 'content', standingSeasonId: null, events: [], reacted: [] };
}
