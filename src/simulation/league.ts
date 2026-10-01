import type { StandingRow } from '@/domain/club';
import type { ClubId, CompetitionId } from '@/domain/ids';
import type { Match } from '@/domain/match';

export interface StandingsInput {
  clubIds: readonly ClubId[];
  matches: readonly Match[];
  competitionId: CompetitionId;
  clubName: (id: ClubId) => string;
  /** How many recent results to keep as form. */
  formLength?: number;
}

interface MutableRow extends StandingsRow {
  formAll: Array<'W' | 'D' | 'L'>;
}

interface StandingsRow {
  clubId: ClubId;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
}

/**
 * The table is always derived from played matches — it is never stored as the
 * source of truth, so it can never drift out of sync with results.
 */
export function computeStandings(input: StandingsInput): StandingRow[] {
  const formLength = input.formLength ?? 5;
  const rows = new Map<ClubId, MutableRow>();
  for (const clubId of input.clubIds) {
    rows.set(clubId, {
      clubId,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      formAll: [],
    });
  }

  const played = input.matches
    .filter((match) => match.competitionId === input.competitionId && match.played && match.result)
    .sort((a, b) => (a.matchday === b.matchday ? a.id.localeCompare(b.id) : a.matchday - b.matchday));

  for (const match of played) {
    const result = match.result!;
    const home = rows.get(match.homeClubId);
    const away = rows.get(match.awayClubId);
    if (!home || !away) continue;

    home.played += 1;
    away.played += 1;
    home.goalsFor += result.homeGoals;
    home.goalsAgainst += result.awayGoals;
    away.goalsFor += result.awayGoals;
    away.goalsAgainst += result.homeGoals;

    if (result.homeGoals > result.awayGoals) {
      home.won += 1;
      away.lost += 1;
      home.formAll.push('W');
      away.formAll.push('L');
    } else if (result.homeGoals < result.awayGoals) {
      away.won += 1;
      home.lost += 1;
      away.formAll.push('W');
      home.formAll.push('L');
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.formAll.push('D');
      away.formAll.push('D');
    }
  }

  const standings: StandingRow[] = [...rows.values()].map((row) => ({
    clubId: row.clubId,
    played: row.played,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    goalDifference: row.goalsFor - row.goalsAgainst,
    points: row.won * 3 + row.drawn,
    form: row.formAll.slice(-formLength),
  }));

  // Points, then goal difference, then goals scored, then alphabetically so
  // ordering is stable and reproducible.
  return standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return input.clubName(a.clubId).localeCompare(input.clubName(b.clubId));
  });
}

export function positionOf(standings: readonly StandingRow[], clubId: ClubId): number | null {
  const index = standings.findIndex((row) => row.clubId === clubId);
  return index < 0 ? null : index + 1;
}
