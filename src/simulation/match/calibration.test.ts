import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { createTestGame, type TestGame } from '../testSupport';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { cloneMatch } from './testHelpers';
import { simulateToCompletion } from './engine';

/**
 * Calibration tests.
 *
 * These lock in the *balance* of the engine: how much a quality gap is worth,
 * whether upsets remain possible and how many goals a Sunday League match
 * produces. Everything is deterministic for a fixed seed, so the ranges here
 * are deliberately looser than the measured values to leave room for tuning
 * without turning them into change-detectors.
 */

function setAllAttributes(state: GameState, clubId: string, value: number): void {
  const club = state.clubs[clubId]!;
  for (const id of club.squadIds) {
    const player = state.people[id];
    if (player?.kind !== 'player') continue;
    for (const group of Object.values(player.attributes)) {
      for (const key of Object.keys(group as unknown as Record<string, number>)) {
        (group as unknown as Record<string, number>)[key] = value;
      }
    }
  }
}

interface Sample {
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  total: number;
}

function sampleQualityGap(homeQuality: number, awayQuality: number, games = 48): Sample {
  const { state, draft }: TestGame = createTestGame(`calibration-${homeQuality}-${awayQuality}`);
  const home = state.clubs[draft.divisionClubIds[0]!]!;
  const away = state.clubs[draft.divisionClubIds[3]!]!;
  setAllAttributes(state, home.id, homeQuality);
  setAllAttributes(state, away.id, awayQuality);
  prepareMatchday(state, 1);

  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === home.id && candidate.awayClubId === away.id,
  )!;
  prepareMatchday(state, fixture.matchday);
  const base: Match = cloneMatch(state.matches[fixture.id]!);

  const sample: Sample = { wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, total: games };
  for (let i = 0; i < games; i++) {
    const match = cloneMatch(base);
    match.seed = 9000 + i * 13;
    simulateToCompletion(match, matchEnvironment(state, match, { autoManageAllBenches: true }));
    const homeGoals = match.result!.homeGoals;
    const awayGoals = match.result!.awayGoals;
    sample.goalsFor += homeGoals;
    sample.goalsAgainst += awayGoals;
    if (homeGoals > awayGoals) sample.wins += 1;
    else if (homeGoals === awayGoals) sample.draws += 1;
    else sample.losses += 1;
  }
  return sample;
}

describe('match engine calibration', () => {
  it('produces a believable number of goals between evenly matched sides', () => {
    const sample = sampleQualityGap(11, 11);
    const perGame = (sample.goalsFor + sample.goalsAgainst) / sample.total;
    expect(perGame).toBeGreaterThan(2.2);
    expect(perGame).toBeLessThan(5.2);
    expect(sample.draws).toBeGreaterThan(3);
    expect(sample.wins).toBeGreaterThan(8);
    expect(sample.losses).toBeGreaterThan(4);
  });

  it('gives a clearly better side the edge without guaranteeing victory', () => {
    const sample = sampleQualityGap(13, 9);
    expect(sample.wins).toBeGreaterThan(sample.total * 0.6);
    // Never a formality: the weaker side is not simply locked out.
    expect(sample.wins).toBeLessThan(sample.total);
    expect(sample.losses + sample.draws).toBeGreaterThan(0);
    expect(sample.goalsFor / sample.total).toBeGreaterThan(2.4);
    expect(sample.goalsAgainst / sample.total).toBeLessThan(1.8);
  });

  it('makes a moderate quality gap count but keeps the game competitive', () => {
    const sample = sampleQualityGap(12, 10);
    const winRate = sample.wins / sample.total;
    expect(winRate).toBeGreaterThan(0.55);
    expect(winRate).toBeLessThan(0.92);
    expect(sample.losses).toBeGreaterThan(1);
  });

  it('produces different scorelines for the same fixture with different seeds', () => {
    const { state } = createTestGame('variation-check');
    prepareMatchday(state, 1);
    const fixture = Object.values(state.matches)[0]!;
    const scorelines = new Set<string>();
    for (let i = 0; i < 14; i++) {
      const match = cloneMatch(fixture);
      match.seed = 300 + i * 91;
      simulateToCompletion(match, matchEnvironment(state, match, { autoManageAllBenches: true }));
      scorelines.add(`${match.result!.homeGoals}-${match.result!.awayGoals}`);
    }
    expect(scorelines.size).toBeGreaterThan(4);
  });
});
