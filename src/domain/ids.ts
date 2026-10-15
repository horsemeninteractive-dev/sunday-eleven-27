/**
 * Branded-ish identifier aliases used across the domain.
 *
 * These are plain strings at runtime (so state stays JSON-serialisable), but
 * naming them makes it obvious which entity an id belongs to at every call site.
 */
export type WorldId = string;
/**
 * A county: the piece of the country a career is played in.
 *
 * Opaque like every other id here — the name is display data and the id is the
 * identity, so a county can be renamed, and a second one added beside it,
 * without anything that belongs to it moving.
 */
export type CountyId = string;
export type RegionId = string;
export type TownId = string;
export type GroundId = string;
export type BusinessId = string;
export type ClubId = string;
export type PersonId = string;
export type PlayerId = string;
export type MatchId = string;
export type CompetitionId = string;
/**
 * A local ladder of football. It is also the id prefix of every competition it
 * owns — `league` → `comp_league_t1` — which is what lets a second pyramid exist
 * without any competition in an existing save being renamed.
 */
export type PyramidId = string;
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
