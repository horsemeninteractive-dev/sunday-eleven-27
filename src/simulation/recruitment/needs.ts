import type { GameState } from '@/domain/game';
import type { ClubId, PlayerId } from '@/domain/ids';
import { isPlayer, type Player } from '@/domain/person';
import {
  formationSlots,
  POSITION_GROUP_LABEL,
  POSITIONS,
  type PositionCode,
  type PositionGroup,
} from '@/domain/positions';
import type { SquadNeed, SquadNeeds } from '@/domain/recruitment';
import { roleCandidates } from '../ai/style';
import { defaultRoleFor, roleProfile, type Role } from '../match/roles';
import { positionScore, roleFitScore } from '../selection';
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

/**
 * How well a man has to know a position before he counts as cover for it.
 *
 * This is the line between "can play there" and "could fill in at a push". It
 * is the same idea the selection screen uses when it calls a man out of
 * position, and it exists so a squad's depth is counted in footballers rather
 * than in names on a list.
 *
 * It is exported because it is also the line a signing has to clear: a club does
 * not replace its centre half with a goalkeeper, and both readings of a squad
 * have to agree about where that line is.
 */
export const PLAYABLE_AT = 0.5;

/** One position the club's shape asks for, and how well the squad answers it. */
export interface SlotAssessment {
  position: PositionCode;
  group: PositionGroup;
  /** The jobs the club's own instructions ask of this position. */
  roles: Role[];
  /** The ordinary version of that job, in words — what the system leans on. */
  roleLabel: string;
  /** How many in the squad could do a job here at all. */
  count: number;
  /** The best of them, 0..1, for the job above. */
  best: number;
  bestId: PlayerId | null;
  /** Slots of this position in the shape the club plays. */
  required: number;
  /** Not enough bodies to cover the shape and have a spare. */
  thin: boolean;
}

/**
 * Where a signing would help, and why — in the club's own football.
 *
 * The weight is only ever compared with the other weights in the same reading;
 * it is an ordering, not a score out of anything.
 */
export interface SigningPriority {
  position: PositionCode;
  group: PositionGroup;
  roles: Role[];
  roleLabel: string;
  weight: number;
  /** A sentence the manager (or an AI club's own log) can act on. */
  reason: string;
}

/**
 * The deeper reading: not just how many bodies, but whether anybody can do the
 * job the club's own football asks of them.
 *
 * `squadNeeds` counts men by area, which is what a manager sees first and is
 * enough for a screen. It cannot tell the difference between a squad with three
 * centre halves and a squad with three centre halves who can all do the job
 * asked of them, and that difference is the whole of a season's recruitment. So
 * this reads the *shape the club actually plays* — the same `formationSlots` the
 * selection screen and the match engine read — and judges the squad against the
 * roles the club's own instructions put on each position.
 *
 * There is deliberately one reading of this and not two: the recruitment screen
 * shows it to the manager, and every AI club shops from the same list, so a
 * manager and his opposite number are looking at the same football. Whether a
 * club then acts on it is a separate question (see `aiClubs.ts`).
 */
export interface SquadAssessment {
  needs: SquadNeeds;
  /** Every position the shape asks for, in the order the shape lists them. */
  slots: SlotAssessment[];
  /** Where a signing would help most, most urgent first. At most one per area. */
  priorities: SigningPriority[];
}

/** How urgent a shortfall is, before the squad's own quality is taken into account. */
const VERDICT_WEIGHT: Record<SquadNeed['verdict'], number> = { thin: 1, ok: 0.45, strong: 0.15 };

export function squadAssessment(state: GameState, clubId: ClubId): SquadAssessment {
  const needs = squadNeeds(state, clubId);
  const club = state.clubs[clubId];
  if (!club) return { needs, slots: [], priorities: [] };

  const shape = formationSlots(club.tactics.formation, club.tactics.shape);
  const squad = club.squadIds.map((id) => state.people[id]).filter(isPlayer);

  const required = new Map<PositionCode, number>();
  for (const slot of shape) required.set(slot.position, (required.get(slot.position) ?? 0) + 1);

  const slots: SlotAssessment[] = [...required.entries()].map(([position, wanted]) => {
    const roles = roleCandidates(position, club.tactics);
    const role = roles[0] ?? defaultRoleFor(position);
    let best = 0;
    let bestId: PlayerId | null = null;
    let count = 0;
    for (const player of squad) {
      if (positionScore(player, position) < PLAYABLE_AT) continue;
      count += 1;
      const fit = roleFitScore(player, position, role);
      if (bestId === null || fit > best) {
        best = fit;
        bestId = player.id;
      }
    }
    return {
      position,
      group: POSITIONS[position].group,
      roles,
      roleLabel: roleProfile(role).label,
      count,
      best,
      bestId,
      required: wanted,
      thin: count < wanted + 1,
    };
  });

  const verdictOf = (group: PositionGroup): SquadNeed['verdict'] =>
    needs.positions.find((entry) => entry.group === group)?.verdict ?? 'ok';
  /** How many men the squad actually lists in this area, which is the area's own count. */
  const registeredIn = (group: PositionGroup): number =>
    needs.positions.find((entry) => entry.group === group)?.registered ?? 0;

  // The most urgent position in each area, and one priority per area rather than
  // one per slot: a Sunday club is short at the back, not short at centre half
  // twice, and a list of eleven positions is a screenful nobody acts on.
  const bestPerGroup = new Map<PositionGroup, SigningPriority>();
  for (const slot of slots) {
    const verdict = verdictOf(slot.group);
    // A squad with nobody at all who can play a position is a bigger problem
    // than its area's tally says, whatever the tally is.
    const weight = Math.min(
      1,
      VERDICT_WEIGHT[verdict] * (0.55 + 0.45 * (1 - slot.best)) + (slot.count === 0 ? 0.2 : 0),
    );
    const label = POSITIONS[slot.position].label.toLowerCase();
    const job = slot.roleLabel.toLowerCase();
    // The sentence has to be true of *both* readings it rests on, because it is
    // printed to a manager and acted on. A position can be well covered while
    // its area is thin — plenty of the squad can fill in at right back, and only
    // four men at the club are defenders — and a sentence that says "short at
    // right back" beside "ten who can play there" is a sentence nobody trusts.
    // So the count quoted is always the one the claim is about.
    const reason = slot.count === 0
      ? `Nobody who can play ${label}.`
      : slot.thin
        ? slot.best < 0.45
          ? `Short at ${label} — nobody in the squad does the ${job} job.`
          : `Only ${slot.count} who can play ${label}, and ${slot.required} shirt${slot.required === 1 ? '' : 's'} to fill.`
        : slot.best < 0.45
          ? `Covered at ${label}, but nobody suited to the ${job} job.`            : verdict === 'thin'
              ? slot.group === 'GK'
                ? `Only ${registeredIn('GK')} goalkeeper${registeredIn('GK') === 1 ? '' : 's'} on the books.`
                : `Only ${registeredIn(slot.group)} ${POSITION_GROUP_LABEL[slot.group].toLowerCase()}s, and ${label} is the least covered of them.`
            : verdict === 'ok'
              ? `Reasonable cover at ${label}.`
              : `Well covered at ${label}.`;

    const existing = bestPerGroup.get(slot.group);
    if (existing && existing.weight >= weight) continue;
    bestPerGroup.set(slot.group, {
      position: slot.position,
      group: slot.group,
      roles: slot.roles,
      roleLabel: slot.roleLabel,
      weight: Math.round(weight * 1000) / 1000,
      reason,
    });
  }

  const priorities = [...bestPerGroup.values()]
    .sort((a, b) => b.weight - a.weight || a.position.localeCompare(b.position))
    .filter((priority) => priority.weight > 0.2);

  return { needs, slots, priorities };
}

/** The one sentence that matters most about this squad, for a header or a log. */
export function topPriorityReason(state: GameState, clubId: ClubId): string | null {
  return squadAssessment(state, clubId).priorities[0]?.reason ?? null;
}

/** How strong the club's own squad is, for judging trialists against it. */
export function squadQuality(state: GameState, clubId: ClubId): number {
  const club = state.clubs[clubId];
  if (!club) return 10;
  const squad = club.squadIds.map((id) => state.people[id]).filter(isPlayer);
  if (squad.length === 0) return 10;
  return squad.reduce((sum, player) => sum + meanAttributeOf(player), 0) / squad.length;
}
