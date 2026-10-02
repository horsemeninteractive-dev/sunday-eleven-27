import { describe, expect, it } from 'vitest';
import { ageOn, defaultManagerProfile, isManagerProfileComplete } from '@/domain/manager';
import { isCompetitiveMatch } from '@/domain/match';
import { isOfficial, isPlayer } from '@/domain/person';
import {
  applyCustomClub,
  backingGrant,
  generateDraft,
  reputationFromAbility,
  squadCost,
  squadForCustomClub,
  squadReputation,
  squadStandardOption,
  startGameFromDraft,
} from '@/simulation/gameSetup';
import { advanceWeek } from '@/simulation/progression';
import { managerCareerRecord } from '@/simulation/queries';
import { createTestGame } from '@/simulation/testSupport';

/**
 * The manager, and the club he builds.
 *
 * Before a career starts the manager says who he is, and — if he wants — the
 * club he is taking charge of does not exist yet. Both travel into the career
 * as plain state, so these tests pin them down where they enter the world.
 */

describe('the manager profile', () => {
  it('derives age from the birthday rather than storing it', () => {
    expect(ageOn('1985-04-12', '2026-07-20')).toBe(41);
    // A birthday still to come this year does not count yet.
    expect(ageOn('1985-12-25', '2026-07-20')).toBe(40);
  });

  it('is only complete with a name and a birthday', () => {
    const profile = defaultManagerProfile('2026-07-20');
    expect(isManagerProfileComplete(profile)).toBe(false);
    expect(isManagerProfileComplete({ ...profile, firstName: 'Dave', surname: 'Fletcher' })).toBe(true);
  });

  it('is carried into the career and names the manager official', () => {
    const draft = generateDraft({ seed: 'manager-profile' });
    const clubId = draft.divisionClubIds[0]!;
    const profile = {
      firstName: 'Dave',
      surname: 'Fletcher',
      nickname: 'Fletch',
      birthday: '1978-03-02',
      occupation: 'Scaffolder',
      hometown: 'Wychavon',
    };
    const state = startGameFromDraft(draft, { seed: draft.seed, clubId, saveName: 'Test', manager: profile });

    expect(state.managerProfile).toMatchObject({
      firstName: 'Dave',
      surname: 'Fletcher',
      nickname: 'Fletch',
      birthday: '1978-03-02',
      occupation: 'Scaffolder',
      hometown: 'Wychavon',
    });
    const manager = state.people['user_manager'];
    expect(manager && isOfficial(manager)).toBe(true);
    expect(manager?.firstName).toBe('Dave');
    expect(manager?.surname).toBe('Fletcher');
    expect(manager?.occupation).toBe('Scaffolder');
  });

  it('fills in a complete identity even when the manager gives none', () => {
    const { state } = createTestGame('nameless-manager');
    expect(state.managerProfile.firstName.length).toBeGreaterThan(0);
    expect(state.managerProfile.surname.length).toBeGreaterThan(0);
    expect(state.managerProfile.birthday).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('creating a club', () => {
  it('takes the place of the weakest club in the bottom division but generates its own squad', () => {
    const draft = generateDraft({ seed: 'custom-club' });
    // A club the manager builds starts at the bottom of the pyramid, so the
    // place it takes is the weakest club in the *lowest* division rather than
    // the weakest in the county.
    const bottomDivision = draft.divisions[draft.divisions.length - 1]!;
    const weakest = [...bottomDivision].sort(
      (a, b) => draft.clubs[a]!.reputation - draft.clubs[b]!.reputation,
    )[0]!;
    const squadBefore = [...draft.clubs[weakest]!.squadIds];

    const clubId = applyCustomClub(draft, {
      name: 'The Woolpack Wanderers',
      shortName: 'Woolpack',
      nickname: 'The Pack',
      motto: 'Drink less, win more.',
      foundedYear: 2011,
      primary: '#123456',
      secondary: '#ffffff',
      structure: 'pub-backed',
      backing: 'well-backed',
      squadStandard: 'mid-table',
      squadSize: 20,
      townId: draft.world.townIds[0]!,
      groundName: 'The Woolpack Field',
      capacity: 750,
      surface: 'grass',
    });

    expect(clubId).toBe(weakest);
    const club = draft.clubs[clubId]!;
    expect(club.identity.name).toBe('The Woolpack Wanderers');
    expect(club.identity.shortName).toBe('Woolpack');
    expect(club.identity.colours).toEqual({ primary: '#123456', secondary: '#ffffff' });
    expect(club.structure).toBe('pub-backed');
    // The manager picks the pot, but not the standing: the club is rated on the
    // players that pot actually bought, and on nothing else.
    const signed = club.squadIds.map((id) => draft.people[id]).filter(isPlayer);
    expect(club.reputation).toBe(squadReputation(signed));
    expect(draft.world.grounds[club.groundId]?.name).toBe('The Woolpack Field');
    expect(draft.world.grounds[club.groundId]?.tenantClubId).toBe(clubId);

    // A brand-new squad, not the displaced side's players: the old names are
    // gone from the world and every new one is registered to the new club.
    expect(club.squadIds).not.toEqual(squadBefore);
    // Exactly the number of players the manager chose to sign.
    expect(club.squadIds.length).toBe(20);
    for (const id of squadBefore) expect(draft.people[id]).toBeUndefined();
    for (const id of club.squadIds) {
      const player = draft.people[id];
      if (!isPlayer(player)) throw new Error(`squad member ${id} is not a player`);
      expect(player.clubId).toBe(clubId);
      expect(player.registered).toBe(true);
      // A new dressing room is still a dressing room: the squad knows itself.
      expect((draft.relationships.byPerson[id] ?? []).length).toBeGreaterThan(0);
    }
  });

  it('produces a playable career the moment it is built', () => {
    const draft = generateDraft({ seed: 'custom-club-play' });
    const clubId = applyCustomClub(draft, {
      name: 'AFC Testville',
      shortName: 'Testville',
      nickname: 'The Villagers',
      motto: '',
      foundedYear: 2015,
      primary: '#c0392b',
      secondary: '#000000',
      structure: 'community',
      backing: 'whip-round',
      squadStandard: 'pub-side',
      squadSize: 18,
      townId: draft.world.townIds[0]!,
      groundName: '',
      capacity: 400,
      surface: 'grass (uneven)',
    });
    const state = startGameFromDraft(draft, {
      seed: draft.seed,
      clubId,
      saveName: 'AFC Testville',
      manager: { firstName: 'Sam', surname: 'Hughes', nickname: '', birthday: '1980-01-01', occupation: '', hometown: '' },
    });

    expect(state.userClubId).toBe(clubId);
    const club = state.clubs[clubId]!;
    expect(club.identity.name).toBe('AFC Testville');
    expect(club.squadIds.length).toBeGreaterThan(0);
    // The standing survives into the career as the one the squad earns — a
    // makeweight side, because a pub side is what the money bought.
    const squad = club.squadIds.map((id) => state.people[id]).filter(isPlayer);
    expect(club.reputation).toBe(squadReputation(squad));
    expect(club.reputation).toBeLessThan(40);
    expect(state.matchOrder.length).toBeGreaterThan(0);
  });

  it('previews exactly the squad the career is given', () => {
    const draft = generateDraft({ seed: 'squad-preview' });
    const design = {
      name: 'AFC Preview',
      shortName: 'Preview',
      nickname: 'The Previews',
      motto: '',
      foundedYear: 2014,
      primary: '#123456',
      secondary: '#ffffff',
      structure: 'community' as const,
      backing: 'well-backed' as const,
      squadStandard: 'mid-table' as const,
      squadSize: 21,
      townId: draft.world.townIds[0]!,
      groundName: '',
      capacity: 500,
      surface: 'grass' as const,
    };

    // What the designer shows the manager before he commits...
    const projected = squadForCustomClub(draft, {
      squadStandard: design.squadStandard,
      squadSize: design.squadSize,
      townId: design.townId,
    });
    expect(projected.length).toBe(21);

    // ...is the squad the career actually signs, name by name.
    const clubId = applyCustomClub(draft, design);
    const club = draft.clubs[clubId]!;
    expect(club.squadIds).toEqual(projected.map((player) => player.id));
    for (const player of projected) {
      const signed = draft.people[player.id];
      if (!isPlayer(signed)) throw new Error(`${player.id} was not signed`);
      expect(signed.firstName).toBe(player.firstName);
      expect(signed.surname).toBe(player.surname);
      expect(signed.positionGroup).toBe(player.positionGroup);
      expect(signed.age).toBe(player.age);
      expect(signed.townId).toBe(design.townId);
    }

    // And the budget is settled on day one: the grant came in, the players went
    // out, and whatever was left over is the club's opening balance.
    const grant = backingGrant(design.backing);
    const spend = squadCost(design.squadStandard, design.squadSize);
    expect(club.finances.ledger).toHaveLength(2);
    const [grantLine, signings] = club.finances.ledger;
    expect(grantLine).toMatchObject({ category: 'other', amount: grant });
    expect(signings).toMatchObject({ category: 'signing', amount: -spend });
    expect(club.finances.balance).toBe(grant - spend);

    // And the standing the designer printed is the one the career stored: both
    // are read off the same squad, so neither can drift.
    expect(club.reputation).toBe(squadReputation(projected));
  });

  it('buys a better squad for a higher standard, and more players for bigger backing', () => {
    const draft = generateDraft({ seed: 'squad-standard' });
    const townId = draft.world.townIds[0]!;
    const meanPassing = (squadStandard: 'pub-side' | 'ringers') => {
      const squad = squadForCustomClub(draft, { squadStandard, squadSize: 20, townId });
      return squad.reduce((sum, player) => sum + player.attributes.technical.passing, 0) / squad.length;
    };

    // The standard is what was paid for: the same rolls, a clearly better side.
    expect(meanPassing('ringers')).toBeGreaterThan(meanPassing('pub-side') + 0.8);

    // More backing does not buy quality by itself — it buys a bigger pot, and
    // the pot stretches to more players at the same standard.
    const fee = squadStandardOption('mid-table').feePerPlayer;
    const signable = (backing: Parameters<typeof backingGrant>[0]) => Math.floor(backingGrant(backing) / fee);
    expect(signable('moneyed')).toBeGreaterThan(signable('whip-round'));
    // And the pot does not buy the best players either: a full squad of ringers
    // costs more than the richest backing in the game can put up.
    expect(squadCost('ringers', 25)).toBeGreaterThan(backingGrant('moneyed'));
  });

  it('rungs the backing so each step unlocks a better standard', () => {
    const affords = (backing: Parameters<typeof backingGrant>[0], standard: Parameters<typeof squadCost>[0], size: number) =>
      squadCost(standard, size) <= backingGrant(backing);

    // The bottom rung: a full squad, but only of mid-table players — the best
    // players in the league are out of reach even at the smallest squad size.
    expect(affords('whip-round', 'mid-table', 25)).toBe(true);
    expect(affords('whip-round', 'contenders', 18)).toBe(false);
    // One rung up buys quality by cutting the squad.
    expect(affords('modest', 'contenders', 18)).toBe(true);
    expect(affords('modest', 'ringers', 18)).toBe(false);
    // And the committee's money stretches to a bigger standard squad, but not a
    // full one: the rungs are sized so nobody can buy everything.
    expect(affords('well-backed', 'contenders', 18)).toBe(true);
    expect(affords('well-backed', 'contenders', 25)).toBe(false);
    // The top of the ladder can just about afford the very best, briefly.
    expect(affords('moneyed', 'ringers', 18)).toBe(true);
    expect(affords('moneyed', 'ringers', 19)).toBe(false);
  });

  it('rates a new club by the players it bought rather than the money it had', () => {
    const draft = generateDraft({ seed: 'rate-the-squad' });
    const townId = draft.world.townIds[0]!;
    const standing = (squadStandard: Parameters<typeof squadCost>[0], squadSize: number) =>
      squadReputation(squadForCustomClub(draft, { squadStandard, squadSize, townId }));

    // Each standard of player is a rung of the reputation ladder, in order.
    const rungs = [standing('pub-side', 18), standing('mid-table', 18), standing('contenders', 18), standing('ringers', 18)];
    expect([...rungs].sort((a, b) => a - b)).toEqual(rungs);

    // The pot does not buy a reputation: a pub side bought with the biggest
    // backing in the game is still worth less than ringers bought with the
    // smallest. The money is what you spend, the players are what you are.
    expect(standing('pub-side', 25)).toBeLessThan(standing('ringers', 18));

    // So a club built on journeymen cannot be a favourite with a squad that
    // ranks bottom: it is a makeweight side, and the division knows it.
    const pubSideStanding = standing('pub-side', 18);
    const clubId = applyCustomClub(draft, {
      name: 'AFC Journeymen',
      shortName: 'Journeymen',
      nickname: '',
      motto: '',
      foundedYear: 2019,
      primary: '#123456',
      secondary: '#ffffff',
      structure: 'members',
      backing: 'moneyed',
      squadStandard: 'pub-side',
      squadSize: 18,
      townId,
      groundName: '',
      capacity: 400,
      surface: 'grass',
    });
    const club = draft.clubs[clubId]!;
    const rivals = draft.divisionClubIds.filter((id) => id !== clubId).map((id) => draft.clubs[id]!.reputation);
    expect(club.reputation).toBe(pubSideStanding);
    expect(club.reputation).toBeLessThan(Math.max(...rivals));
    expect(club.reputation).toBeLessThanOrEqual(40);
  });

  it('wears the badge the manager designed, and only the parts he decided', () => {
    const draft = generateDraft({ seed: 'badge-designer' });
    const design = {
      name: 'Haxbridge Dockers',
      shortName: 'Dockers',
      nickname: 'The Dockers',
      motto: '',
      foundedYear: 1911,
      primary: '#0d47a1',
      secondary: '#ffd54f',
      structure: 'pub-backed' as const,
      backing: 'modest' as const,
      squadStandard: 'mid-table' as const,
      squadSize: 18,
      townId: draft.world.townIds[0]!,
      groundName: '',
      capacity: 500,
      surface: 'grass' as const,
      badge: { shape: 'pennant' as const, device: 'ship' as const },
    };

    const clubId = applyCustomClub(draft, design);
    expect(draft.clubs[clubId]!.badge).toEqual({ shape: 'pennant', device: 'ship' });

    // A club that designed nothing carries nothing, so the drawing code still
    // makes the badge it would have given any other club in the world.
    const { badge: _designed, ...bare } = design;
    const bareDraft = generateDraft({ seed: 'badge-designer' });
    const bareId = applyCustomClub(bareDraft, bare);
    expect(bareDraft.clubs[bareId]!.badge).toBeUndefined();
  });

  it('reads a squad\u2019s quality back onto the world\u2019s reputation scale', () => {
    // The two scales are the same line run both ways: standing 50 is quality
    // 10.6, so a squad at 10.6 is a 50 — never below the floor or above the
    // ceiling, and never a favourite for a pub side.
    expect(reputationFromAbility(10.6)).toBe(50);
    expect(reputationFromAbility(9.4)).toBe(24);
    expect(reputationFromAbility(4)).toBe(20);
    expect(reputationFromAbility(18)).toBe(80);
  });
});

describe("the manager's career record", () => {
  it('starts empty, in the manager\u2019s first season', () => {
    const { state, clubId } = createTestGame('career-record');
    const record = managerCareerRecord(state, clubId);
    expect(record.seasons).toBe(1);
    expect(record.played).toBe(0);
    expect(record.winPercent).toBe(0);
  });

  it('counts competitive matches and never the summer friendlies', () => {
    const { state, clubId } = createTestGame('career-record-play');
    // The summer is already booked: three warm-ups, none of them recorded.
    const friendlies = Object.values(state.matches).filter(
      (match) => !isCompetitiveMatch(state, match) && (match.homeClubId === clubId || match.awayClubId === clubId),
    );
    expect(friendlies.length).toBeGreaterThan(0);

    // One week of football takes the career through pre-season and the opener.
    advanceWeek(state, { instant: true });

    expect(friendlies.filter((match) => match.played).length).toBeGreaterThan(0);
    const season = state.clubs[clubId]!.history.seasons.find((entry) => entry.seasonId === state.season.id)!;
    // A month of friendlies and one league game: the record reads one game.
    expect(season.played).toBe(1);

    const record = managerCareerRecord(state, clubId);
    expect(record.played).toBe(1);
    expect(record.won).toBe(season.won);
    expect(record.drawn).toBe(season.drawn);
    expect(record.lost).toBe(season.lost);
    expect(record.goalsFor).toBe(season.goalsFor);
    expect(record.goalsAgainst).toBe(season.goalsAgainst);
    expect(record.winPercent).toBe(record.won === 1 ? 100 : 0);
  });

  it('adds the seasons together and works out a win rate', () => {
    const { state, clubId } = createTestGame('career-record-sum');
    const club = state.clubs[clubId]!;
    // A completed season behind him, of the sort the rollover leaves in place.
    club.history.seasons.unshift({
      seasonId: 'season_past',
      seasonLabel: '2025/26',
      competitionName: 'A league',
      tier: 1,
      played: 20,
      won: 11,
      drawn: 4,
      lost: 5,
      goalsFor: 44,
      goalsAgainst: 30,
      points: 37,
      finalPosition: 3,
    });

    const record = managerCareerRecord(state, clubId);
    expect(record.seasons).toBe(2);
    expect(record.played).toBe(20);
    expect(record.won).toBe(11);
    expect(record.drawn).toBe(4);
    expect(record.lost).toBe(5);
    expect(record.goalsFor).toBe(44);
    expect(record.goalsAgainst).toBe(30);
    expect(record.points).toBe(37);
    expect(record.winPercent).toBe(55);
  });
});
