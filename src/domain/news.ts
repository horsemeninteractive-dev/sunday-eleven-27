import type { ClubId, ISODate, MatchId, NewsId, PersonId } from './ids';

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
  /** The club off the pitch: AGM, committee, fundraising, sponsors, the ground. */
  | 'club-event'
  /** Five-a-side, a social, a testimonial — the life around the football. */
  | 'social'
  /** Somebody else's world: a local club, a job moving, a rumour worth hearing. */
  | 'world'
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
  read: boolean;
}
