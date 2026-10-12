import type { ClubId, ISODate } from './ids';

/**
 * The manager's own career.
 *
 * Everything else in the game is about a club: its squad, its money, its
 * fixtures. This is the small piece that is about *him* — which club he is in
 * charge of now, the clubs he has managed before, and the posts he can apply for
 * while he is out of work. It is deliberately a store on the career rather than
 * fields scattered across the world, because "is the manager employed, and
 * where?" is a question the whole game has to be able to answer.
 *
 * The one rule that keeps it honest: **while he is out of work there is no club
 * he manages**, and every system that used to mean "the manager's club" asks
 * this store rather than assuming `userClubId` is it. `userClubId` is retained
 * through unemployment as the club he last managed — the anchor the archive and
 * the screens point at — but it is not his club until `status` says so again.
 */

export type CareerStatus =
  /** In charge of `clubId`. */
  | 'employed'
  /** Between jobs: no club, applying for posts. */
  | 'unemployed';

/** How one spell in charge ended. */
export type SpellEnding =
  /** The committee parted ways with him. */
  | 'dismissed'
  /** He moved to another club (the spell simply ended). */
  | 'moved'
  /**
   * The club itself went under him.
   *
   * Not a dismissal: nobody decided anything. The club could not pay its way
   * and stopped existing, and the spell ended with it — which is why the
   * record keeps the reason apart from a committee's decision.
   */
  | 'club-folded';

/** One run of matches in charge of one club. */
export interface CareerSpell {
  clubId: ClubId;
  from: ISODate;
  /** Null while he is still there. */
  to: ISODate | null;
  /** How it ended, once it has. */
  ending: SpellEnding | null;
}

/**
 * A post the manager can apply for while he is out of work.
 *
 * Posted when a club's job comes free at the season boundary and held open for a
 * short window so the man between jobs gets first refusal before the rest of the
 * county's managers are appointed over him.
 */
export interface JobOpening {
  clubId: ClubId;
  /** The day the vacancy was advertised. */
  postedOn: ISODate;
  /** The day the club stops waiting and appoints somebody else. */
  closesOn: ISODate;
  /** Where the club plays, and what it expects — the board's own words. */
  note: string;
}

export interface CareerState {
  status: CareerStatus;
  /** The club he manages now, or null while he is between jobs. */
  clubId: ClubId | null;
  /** The club he was most recently dismissed from, for the story and the board. */
  lastClubId: ClubId | null;
  /** Every club he has managed, oldest first. */
  spells: CareerSpell[];
  /** Posts he may apply for. Only ever populated while unemployed. */
  openings: JobOpening[];
  /** Clubs he has already approached this spell out of work, so one ask is one ask. */
  applied: ClubId[];
}

export function emptyCareerState(): CareerState {
  return { status: 'employed', clubId: null, lastClubId: null, spells: [], openings: [], applied: [] };
}
