/**
 * Branded-ish identifier aliases used across the domain.
 *
 * These are plain strings at runtime (so state stays JSON-serialisable), but
 * naming them makes it obvious which entity an id belongs to at every call site.
 */
export type WorldId = string;
export type TownId = string;
export type GroundId = string;
export type BusinessId = string;
export type ClubId = string;
export type PersonId = string;
export type PlayerId = string;
export type MatchId = string;
export type CompetitionId = string;
export type SeasonId = string;
export type NewsId = string;
export type EventId = string;
export type RelationshipId = string;
export type ConversationId = string;
export type MessageId = string;

/** ISO calendar date, `YYYY-MM-DD`. Game time is day-granular. */
export type ISODate = string;

export type ClubRole =
  | 'player'
  | 'player-manager'
  | 'manager'
  | 'assistant'
  | 'coach'
  | 'physio'
  | 'chairman'
  | 'secretary'
  | 'treasurer'
  | 'scout'
  | 'volunteer';
