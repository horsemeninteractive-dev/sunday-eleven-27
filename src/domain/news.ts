import type { ClubId, ISODate, MatchId, NewsId, PersonId } from './ids';
import type { RumourStatus } from './press';

/**
 * News is generated from *structured events*. The event carries the facts;
 * `writeNewsItem` turns it into prose using templates. Systems (journalists,
 * social media, the archive) can consume the same events later.
 */
export type GameEventType =
  | 'match-result'
  | 'goal-milestone'
  | 'appearance-milestone'
  | 'injury'
  | 'player-unavailable'
  | 'player-signed'
  | 'player-released'
  | 'league-movement'
  /** A cup round drawn: who has been drawn against whom, and when they play. */
  | 'cup-draw'
  /** Something a cup decided: a final, a winner, or a giant-killing. */
  | 'cup-result'
  | 'notable-result'
  | 'finances-warning'
  | 'finances-positive'
  | 'availability-crisis'
  | 'club-news'
  /** Something happened between two people: a row, a praise, a departure. */
  | 'dressing-room'
  /** Recruitment: a recommendation, a trial, an approach, a signing falling through. */
  | 'recruitment'
  /** A player has asked a club about a game. */
  | 'player-approach'
  /** Thursday night: who turned up, what was worked on, what it cost. */
  | 'training'
  /** Somebody has visibly got better at something, over weeks of work. */
  | 'development'
  | 'referee-assigned'
  | 'weather-warning'
  | 'season-milestone'
  /** A fixture called off, with the reason, and when it will be played instead. */
  | 'postponement'
  /** A side could not field a team, so the fixture went to the opposition 3–0. */
  | 'forfeit'
  /** The club off the pitch: AGM, committee, fundraising, sponsors, the ground. */
  | 'club-event'
  /** Five-a-side, a social, a testimonial — the life around the football. */
  | 'social'
  /** Somebody else's world: a local club, a job moving, a rumour worth hearing. */
  | 'world'
  /**
   * A local reporter has heard something and printed it. Unverified by
   * construction: the claim is a claim, and the paper says so.
   */
  | 'press-rumour'
  /**
   * The world settled a claim the press had filed: it turned out to be right,
   * or it did not, or the question stopped mattering.
   */
  | 'press-verdict'
  /** Something the calendar wants the manager to notice about the coming days. */
  | 'calendar';

export interface GameEvent {
  id: string;
  type: GameEventType;
  date: ISODate;
  importance: 1 | 2 | 3;
  clubIds: ClubId[];
  personIds: PersonId[];
  matchId: MatchId | null;
  /** Structured facts for templates and future systems. */
  data: Record<string, string | number>;
}

export type NewsCategory = 'Match' | 'Squad' | 'Club' | 'League' | 'World' | 'Finances';

export interface NewsItem {
  id: NewsId;
  date: ISODate;
  category: NewsCategory;
  importance: 1 | 2 | 3;
  headline: string;
  body: string;
  clubIds: ClubId[];
  personIds: PersonId[];
  matchId: MatchId | null;
  eventId: string;
  /**
   * What kind of thing happened, kept beside the item rather than only in the
   * event it came from.
   *
   * `category` is a *column* — six of them, because a paper has six places to
   * put a story — and every one of the event types this game writes is filed
   * into one of those six. That is the right answer for a filter and the wrong
   * one for a picture: a cup final, a postponement and a routine result are all
   * three categories apart at most, and a signing, a release and an injury are
   * one.
   *
   * So the type travels with the item. It cannot be recovered from `eventId`
   * (an opaque counter) and the event itself is not kept — `publishEvents`
   * writes items and nothing else — so this is the one place it can live.
   *
   * Optional, deliberately: a career saved before this field existed has items
   * without it, and the interface falls back to the category rather than
   * refusing to draw them. Missing means "filed under a column", not corrupt.
   */
  eventType?: GameEventType;
  /**
   * Who carried it, when it was carried by anybody.
   *
   * A story with no outlet is one nobody filed: a routine result the club knows
   * about because it was there, not because a reporter wrote it down. The
   * absence is meaningful rather than missing data — it is the difference
   * between the paper running a line and a manager happening to know something.
   */
  outlet?: string;
  /** The reporter's name, as it would appear under his own story. */
  byline?: string;
  /** Which reporter filed it, so the press record can be kept straight. */
  journalistId?: PersonId;
  /**
   * How much of this is fact.
   *
   * Absent means "not a claim either way" — an ordinary report of something that
   * happened. Present, it is the claim's standing: unconfirmed while it is live,
   * and confirmed, disproved or gone quiet once the world has settled it. The
   * interface draws the difference; the simulation never mixes the two.
   */
  confidence?: RumourStatus;
  read: boolean;
}
