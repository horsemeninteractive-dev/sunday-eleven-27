import { describe, expect, it } from 'vitest';
import type { KitSet } from '@/domain/kit';
import { createTestGame } from '@/simulation/testSupport';
import { colourDistance, contrastRatio, DARK_INK, LIGHT_INK } from './colour';
import {
  chosenKitOption,
  clubKit,
  clubKitOptions,
  KIT_MAKERS,
  KIT_OPTION_COUNT,
  kitPlanFor,
  MIN_KIT_DISTANCE,
  sponsorFromBusiness,
  sponsorFor,
  type KitRequest,
} from './kit';

/**
 * Kits are the most visible thing about a club, so the rules are worth holding
 * down: a home shirt is always the club's own colours, the three strips are
 * always tellable apart, and a new season means a new kit without anything
 * being saved for it.
 */

function request(seed: string, clubId = 'club_1', seasonLabel = '2026/27'): KitRequest {
  return {
    seed,
    clubId,
    seasonLabel,
    colours: { primary: '#c62828', secondary: '#ffffff' },
    sponsor: { id: 'biz_1', name: 'The Old White Hart', businessId: 'biz_1' },
  };
}

function stripFingerprint(kit: KitSet): string {
  return JSON.stringify([kit.home, kit.away, kit.goalkeeper]);
}

describe('a generated kit', () => {
  it('is the same kit every time it is drawn for that season', () => {
    const a = kitPlanFor(request('stable'), 1);
    const b = kitPlanFor(request('stable'), 1);
    expect(stripFingerprint(a)).toBe(stripFingerprint(b));
    expect(a.maker.id).toBe(b.maker.id);
  });

  it('wears the club’s own colours at home, whatever design is chosen', () => {
    for (const option of [0, 1, 2]) {
      const kit = kitPlanFor(request('home-colours'), option);
      expect(kit.home.primary).toBe('#c62828');
      // The white second colour is far enough away to be used as it is.
      expect(kit.home.secondary).toBe('#ffffff');
    }
  });

  it('gives a club whose two colours sit on top of each other a working pattern colour', () => {
    const kit = kitPlanFor(
      { ...request('muddy'), colours: { primary: '#c62828', secondary: '#c03030' } },
      0,
    );
    expect(kit.home.primary).toBe('#c62828');
    expect(colourDistance(kit.home.primary, kit.home.secondary)).toBeGreaterThan(60);
  });

  it('draws three strips that can be told apart on the pitch', () => {
    const kit = kitPlanFor(request('distinct'), 0);
    expect(colourDistance(kit.away.primary, kit.home.primary)).toBeGreaterThanOrEqual(MIN_KIT_DISTANCE);
    expect(kit.away.primary).not.toBe(kit.home.secondary);
    expect(colourDistance(kit.goalkeeper.primary, kit.home.primary)).toBeGreaterThanOrEqual(MIN_KIT_DISTANCE);
    expect(kit.goalkeeper.primary).not.toBe(kit.away.primary);
  });

  it('prints the sponsor in the more legible of the two inks on every strip', () => {
    for (const option of [0, 1, 2]) {
      const kit = kitPlanFor(request('legible', 'club_7'), option);
      for (const design of [kit.home, kit.away, kit.goalkeeper]) {
        const other = design.ink === LIGHT_INK ? DARK_INK : LIGHT_INK;
        expect(contrastRatio(design.ink, design.primary)).toBeGreaterThanOrEqual(
          contrastRatio(other, design.primary),
        );
      }
    }
  });

  it('only chooses a change strip colour a name can actually be printed on', () => {
    // The home shirt is the club's own colour and is left alone — the sponsor's
    // name carries a halo on the shirt, as a badge's name does. The away and
    // goalkeeper colours are chosen here, so they have to clear 4.5:1.
    for (const clubId of ['club_1', 'club_2', 'club_3', 'club_9', 'club_12']) {
      for (const option of [0, 1, 2]) {
        const kit = kitPlanFor(request('printable', clubId), option);
        for (const design of [kit.away, kit.goalkeeper]) {
          expect(contrastRatio(design.ink, design.primary)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('is made by a real kit firm, and only ever by one of them', () => {
    for (const clubId of ['club_1', 'club_2', 'club_3', 'club_4', 'club_5']) {
      const kit = kitPlanFor(request('makers', clubId));
      expect(KIT_MAKERS.map((maker) => maker.id)).toContain(kit.maker.id);
    }
  });

  it('shows the sponsor the club actually has', () => {
    expect(sponsorFromBusiness(undefined)).toBeNull();
    expect(
      sponsorFromBusiness({
        id: 'biz_9',
        name: 'Riverside Garage',
        kind: 'garage',
        townId: 'town_1',
        wealth: 12,
        sponsoredClubIds: [],
      }),
    ).toEqual({ id: 'biz_9', name: 'Riverside Garage', businessId: 'biz_9' });
  });
});

describe('the designs on offer', () => {
  it('offers the manager a choice, and the choice is not one shirt three times', () => {
    const options = clubKitOptions(createTestGame('options').state, 'club_1');
    expect(options).toHaveLength(KIT_OPTION_COUNT);
    const patterns = new Set(options.map((kit) => `${kit.home.pattern}-${kit.away.primary}-${kit.goalkeeper.primary}`));
    expect(patterns.size).toBeGreaterThan(1);
    // The kit deal does not change with the design.
    expect(new Set(options.map((kit) => kit.maker.id)).size).toBe(1);
    expect(new Set(options.map((kit) => kit.sponsor?.id ?? 'none')).size).toBe(1);
  });

  it('keeps every option in the club’s colours', () => {
    const { state, clubId } = createTestGame('option-colours');
    const club = state.clubs[clubId]!;
    for (const kit of clubKitOptions(state, clubId)) {
      expect(kit.home.primary).toBe(club.identity.colours.primary);
    }
  });
});

describe('a club’s kit in a career', () => {
  it('is rebuilt from the state, and every club in the division has one', () => {
    const { state } = createTestGame('division-kits');
    for (const clubId of Object.keys(state.clubs)) {
      const kit = clubKit(state, clubId);
      expect(kit).not.toBeNull();
      expect(kit!.home.primary).toBe(state.clubs[clubId]!.identity.colours.primary);
      expect(kit!.season).toBe(state.season.label);
    }
    expect(clubKit(state, 'nobody')).toBeNull();
  });

  it('heads the shirt with the club’s own sponsor where it has one', () => {
    const { state } = createTestGame('sponsor-kit');
    const sponsored = Object.values(state.clubs).find((club) => club.sponsorIds.length > 0);
    if (sponsored) {
      const business = state.world.businesses[sponsored.sponsorIds[0]!]!;
      expect(sponsorFor(state, sponsored)?.name).toBe(business.name);
      expect(clubKit(state, sponsored.id)?.sponsor?.name).toBe(business.name);
    }
  });

  it('changes at the start of a new season, without anything being saved', () => {
    const { state, clubId } = createTestGame('season-kits');
    const thisSeason = clubKit(state, clubId)!;
    const nextSeason = kitPlanFor(
      { seed: state.seed, clubId, seasonLabel: '2027/28', colours: state.clubs[clubId]!.identity.colours, sponsor: null },
      chosenKitOption(state.clubs[clubId]!),
    );
    expect(nextSeason.season).toBe('2027/28');
    expect(stripFingerprint(nextSeason)).not.toBe(stripFingerprint(thisSeason));
  });

  it('rolls the whole division over into different shirts each summer', () => {
    const { state } = createTestGame('rollover-kits');
    const changed = Object.values(state.clubs).filter((club) => {
      const request = {
        seed: state.seed,
        clubId: club.id,
        colours: club.identity.colours,
        sponsor: null,
      };
      const before = kitPlanFor({ ...request, seasonLabel: state.season.label }, 0);
      const after = kitPlanFor({ ...request, seasonLabel: '2027/28' }, 0);
      return before.home.pattern !== after.home.pattern || before.away.primary !== after.away.primary;
    });
    // A handful could coincide; a whole division wearing the same strip twice
    // would mean the season is not in the seed at all.
    expect(changed.length).toBeGreaterThan(Object.keys(state.clubs).length * 0.5);
  });

  it('falls back to the first design when the stored choice is nonsense', () => {
    const { state, clubId } = createTestGame('choice-fallback');
    const club = state.clubs[clubId]!;
    const first = clubKitOptions(state, clubId)[0]!;
    for (const nonsense of [99, -3, 0.9, Number.NaN]) {
      club.kitChoice = nonsense;
      expect(stripFingerprint(clubKit(state, clubId)!)).toBe(stripFingerprint(first));
    }
    club.kitChoice = 2;
    expect(clubKit(state, clubId)!.option).toBe(2);
  });
});
