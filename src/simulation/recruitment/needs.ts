import type { GameState } from '@/domain/game';
import type { ClubId } from '@/domain/ids';
import { isPlayer, type Player } from '@/domain/person';
import { POSITION_GROUP_LABEL, type PositionGroup } from '@/domain/positions';
import type { SquadNeed, SquadNeeds } from '@/domain/recruitment';
import { meanAttributeOf } from './knowledge';

/**
 * What the squad is actually short of.
 *
 * The manager gets information, not a recommendation: how many are registered,
 * how many are realistically available on a Sunday, and how many are the sort
 * of player you can count on. Whether that means signing somebody is his call.
 */

const GROUPS: PositionGroup[] = ['GK', 'DEF', 'MID', 'FWD'];

const MINIMUM: Record<PositionGroup, number> = { GK: 2, DEF: 6, MID: 6, FWD: 4 };

const THIN_NOTE: Record<PositionGroup, string> = {
  GK: 'One bad knee away from an outfield player in goal.',
  DEF: 'Short at the back — an injury or two and you are patching it up.',
  MID: 'Light in midfield; legs will be a problem by October.',
  FWD: 'Nobody up front to change a game from the bench.',
};

const STRONG_NOTE: Record<PositionGroup, string> = {
  GK: 'Two keepers you can pick without thinking about it.',
  DEF: 'Well covered at the back.',
  MID: 'Plenty of options in midfield.',
  FWD: 'More forwards than you can give minutes to.',
};

function reliableBy(player: Player): boolean {
  return player.attributes.behavioural.reliability >= 11 && player.attributes.hidden.consistency >= 10;
}

export function squadNeeds(state: GameState, clubId: ClubId): SquadNeeds {
  const club = state.clubs[clubId];
  if (!club) {
    return { positions: [], thinGroups: [], summary: [], byPosition: {} };
  }
  const squad = club.squadIds.map((id) => state.people[id]).filter(isPlayer);

  const byPosition: Record<string, number> = {};
  for (const player of squad) {
    byPosition[player.preferredPosition] = (byPosition[player.preferredPosition] ?? 0) + 1;
  }

  const positions: SquadNeed[] = GROUPS.map((group) => {
    const members = squad.filter((player) => player.positionGroup === group);
    const available = members.filter((player) => player.availability.status === 'available');
    const reliable = members.filter(reliableBy);
    const averageAge =
      members.length > 0 ? Math.round((members.reduce((sum, player) => sum + player.age, 0) / members.length) * 10) / 10 : 0;
    const thin = members.length < MINIMUM[group] || available.length < Math.min(3, MINIMUM[group] - 1) + 1;
    const strong = members.length >= MINIMUM[group] + 3 && reliable.length >= MINIMUM[group];
    return {
      group,
      label: POSITION_GROUP_LABEL[group],
      registered: members.length,
      available: available.length,
      reliable: reliable.length,
      averageAge,
      verdict: thin ? 'thin' : strong ? 'strong' : 'ok',
      note: thin ? THIN_NOTE[group] : strong ? STRONG_NOTE[group] : `${available.length} of ${members.length} available this week.`,
    };
  });

  const thinGroups = positions.filter((entry) => entry.verdict === 'thin').map((entry) => entry.group);
  const summary: string[] = [];

  for (const need of positions) {
    if (need.verdict !== 'thin') continue;
    if (need.group === 'DEF' || need.group === 'MID') {
      const detail = Object.entries(byPosition)
        .filter(([code]) => (need.group === 'DEF' ? ['RB', 'CB', 'LB'].includes(code) : ['DM', 'CM', 'RM', 'LM', 'AM'].includes(code)))
        .sort((a, b) => a[1] - b[1])
        .map(([code, count]) => `${count} ${code}`)
        .join(', ');
      summary.push(`${need.label}: ${detail}.`);
    } else {
      summary.push(`${need.label}: ${need.registered} registered, ${need.available} available.`);
    }
  }

  const ageing = squad.filter((player) => player.age >= 33).length;
  if (ageing >= 5) summary.push(`${ageing} players are 33 or over — the squad will need refreshing soon.`);
  if (squad.length < 18) summary.push(`Only ${squad.length} registered players in total.`);

  return { positions, thinGroups, summary, byPosition };
}

/** How strong the club's own squad is, for judging trialists against it. */
export function squadQuality(state: GameState, clubId: ClubId): number {
  const club = state.clubs[clubId];
  if (!club) return 10;
  const squad = club.squadIds.map((id) => state.people[id]).filter(isPlayer);
  if (squad.length === 0) return 10;
  return squad.reduce((sum, player) => sum + meanAttributeOf(player), 0) / squad.length;
}
