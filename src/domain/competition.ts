import type { ClubId, CompetitionId, MatchId, SeasonId } from './ids';

export type CompetitionKind = 'league' | 'cup';

export interface Competition {
  id: CompetitionId;
  name: string;
  kind: CompetitionKind;
  /** 1 = top of the local pyramid. */
  tier: number;
  seasonId: SeasonId;
  clubIds: ClubId[];
  /** Cup competitions are not in the first slice; leagues are. */
  promotionPlaces?: number;
  relegationPlaces?: number;
}

/**
 * Friendlies are not a competition the world runs.
 *
 * Nothing is at stake, so they have no competition record, no table and no
 * effect on the season's figures — but they are still football, and still the
 * way a squad gets fit and a new shape gets tried out.
 */
export const FRIENDLY_COMPETITION_ID: CompetitionId = 'friendly';
export const FRIENDLY_COMPETITION_NAME = 'Pre-season friendly';

export interface FixtureList {
  competitionId: CompetitionId;
  /** matchday number (1-based) -> match ids. */
  byMatchday: Record<number, MatchId[]>;
  /** match id -> matchday. */
  matchdayOf: Record<MatchId, number>;
}
