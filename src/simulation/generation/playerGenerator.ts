import { clampAttribute, type PlayerAttributes } from '@/domain/attributes';
import type { ClubId, GroundId, ISODate, PlayerId, TownId } from '@/domain/ids';
import { createSystemFamiliarity, emptyPlayerSubs, type Personality, type Player, type PlayerDevelopment, type PlayerRecord } from '@/domain/person';
import { ALL_POSITION_CODES, POSITIONS, positionalSimilarity, type PositionCode, type PositionGroup } from '@/domain/positions';
import { Rng } from '../rng';
import { maybeNickname, occupationForAge, personFirstName, personSurname } from './names';

/**
 * Attribute profiles are expressed as *offsets from the club's general quality
 * level*. A profile therefore describes a type of player ("quick but
 * unreliable", "good passer, poor tackler") rather than a fixed statline, so
 * the same archetype scales from village football to a strong town club.
 */
export interface PlayerArchetype {
  id: string;
  label: string;
  group: PositionGroup;
  preferred: PositionCode[];
  weight: number;
  attrs: Record<string, number>;
}

export const ARCHETYPES: PlayerArchetype[] = [
  {
    id: 'shot-stopper',
    label: 'Shot stopper',
    group: 'GK',
    preferred: ['GK'],
    weight: 3,
    attrs: {
      'technical.goalkeeping': 4.5,
      'technical.crossing': -1,
      'technical.passing': -1,
      'physical.agility': 2,
      'physical.pace': -1,
      'mental.positioning': 2,
      'mental.composure': 1,
    },
  },
  {
    id: 'sweeper-keeper',
    label: 'Keeper who plays out',
    group: 'GK',
    preferred: ['GK'],
    weight: 1.4,
    attrs: {
      'technical.goalkeeping': 3.5,
      'technical.passing': 2,
      'technical.ballControl': 1.5,
      'physical.agility': 2,
      'physical.pace': 1,
      'mental.decisions': 1.5,
    },
  },
  {
    id: 'nonsense-centre-half',
    label: 'No-nonsense centre half',
    group: 'DEF',
    preferred: ['CB'],
    weight: 2.6,
    attrs: {
      'technical.tackling': 2.5,
      'technical.heading': 3,
      'technical.passing': -2.5,
      'technical.ballControl': -2,
      'physical.strength': 3,
      'physical.pace': -1.5,
      'mental.positioning': 2,
      'mental.determination': 1.5,
    },
  },
  {
    id: 'ball-playing-centre-half',
    label: 'Centre half who can play',
    group: 'DEF',
    preferred: ['CB', 'DM'],
    weight: 1.4,
    attrs: {
      'technical.passing': 3,
      'technical.ballControl': 2,
      'technical.tackling': 1,
      'technical.heading': 1.5,
      'physical.pace': -0.5,
      'mental.composure': 2,
      'mental.decisions': 1.5,
    },
  },
  {
    id: 'quick-recovery-defender',
    label: 'Quick recovery defender',
    group: 'DEF',
    preferred: ['CB', 'RB', 'LB'],
    weight: 1.2,
    attrs: {
      'physical.pace': 3,
      'physical.agility': 2,
      'technical.tackling': 1,
      'technical.heading': -1,
      'mental.positioning': -1,
      'mental.decisions': -0.5,
    },
  },
  {
    id: 'attacking-full-back',
    label: 'Overlapping full back',
    group: 'DEF',
    preferred: ['RB', 'LB', 'RM', 'LM'],
    weight: 2,
    attrs: {
      'physical.pace': 2.5,
      'physical.stamina': 2.5,
      'technical.crossing': 2,
      'technical.tackling': -0.5,
      'mental.workRate': 2,
      'mental.positioning': -1,
    },
  },
  {
    id: 'steady-full-back',
    label: 'Steady full back',
    group: 'DEF',
    preferred: ['RB', 'LB'],
    weight: 2,
    attrs: {
      'technical.tackling': 1.5,
      'technical.crossing': 0.5,
      'mental.positioning': 1.5,
      'physical.stamina': 1.5,
      'behavioural.discipline': 1.5,
    },
  },
  {
    id: 'ball-winner',
    label: 'Ball winner',
    group: 'MID',
    preferred: ['DM', 'CM'],
    weight: 2.2,
    attrs: {
      'technical.tackling': 3,
      'physical.stamina': 2.5,
      'physical.strength': 2,
      'mental.workRate': 2.5,
      'mental.determination': 2,
      'technical.passing': -1,
      'technical.shooting': -1.5,
      'behavioural.discipline': -1.5,
    },
  },
  {
    id: 'playmaker',
    label: 'Playmaker',
    group: 'MID',
    preferred: ['CM', 'AM', 'DM'],
    weight: 1.8,
    attrs: {
      'technical.passing': 3.5,
      'technical.ballControl': 2.5,
      'mental.decisions': 2.5,
      'mental.composure': 2,
      'physical.pace': -2,
      'physical.stamina': -1,
      'technical.tackling': -1.5,
    },
  },
  {
    id: 'box-to-box',
    label: 'Box-to-box',
    group: 'MID',
    preferred: ['CM', 'DM', 'AM'],
    weight: 2.4,
    attrs: {
      'physical.stamina': 3.5,
      'physical.pace': 1.5,
      'mental.workRate': 2.5,
      'technical.passing': 0.5,
      'technical.shooting': 0.5,
      'mental.determination': 1.5,
    },
  },
  {
    id: 'wide-midfielder',
    label: 'Wide midfielder',
    group: 'MID',
    preferred: ['RM', 'LM', 'RW', 'LW'],
    weight: 2.2,
    attrs: {
      'physical.pace': 2.5,
      'physical.agility': 2,
      'technical.crossing': 2.5,
      'technical.ballControl': 1.5,
      'technical.tackling': -1.5,
      'mental.workRate': 1,
    },
  },
  {
    id: 'poacher',
    label: 'Poacher',
    group: 'FWD',
    preferred: ['ST'],
    weight: 2,
    attrs: {
      'technical.shooting': 3.5,
      'mental.positioning': 3,
      'mental.composure': 2,
      'physical.pace': 1,
      'technical.passing': -2,
      'mental.workRate': -1.5,
      'technical.heading': -1,
    },
  },
  {
    id: 'target-man',
    label: 'Target man',
    group: 'FWD',
    preferred: ['ST', 'AM'],
    weight: 2,
    attrs: {
      'technical.heading': 3.5,
      'physical.strength': 3.5,
      'physical.pace': -3,
      'technical.shooting': 1.5,
      'physical.agility': -1.5,
    },
  },
  {
    id: 'pacey-forward',
    label: 'Pace in behind',
    group: 'FWD',
    preferred: ['ST', 'RW', 'LW'],
    weight: 2.2,
    attrs: {
      'physical.pace': 3.5,
      'physical.agility': 2,
      'technical.shooting': 1.5,
      'technical.ballControl': 1,
      'mental.composure': -1.5,
      'mental.decisions': -1.5,
    },
  },
  {
    id: 'hard-working-forward',
    label: 'Hard-working forward',
    group: 'FWD',
    preferred: ['ST', 'AM', 'RM'],
    weight: 1.8,
    attrs: {
      'mental.workRate': 3,
      'mental.determination': 2.5,
      'physical.stamina': 2.5,
      'technical.shooting': 0.5,
      'technical.passing': 0.5,
      'physical.strength': 0.5,
    },
  },
  {
    id: 'utility-player',
    label: 'Utility player',
    group: 'MID',
    preferred: ['RB', 'LB', 'CM', 'RM', 'LM'],
    weight: 1.6,
    attrs: {
      'mental.decisions': 1,
      'mental.positioning': 1.5,
      'physical.stamina': 1.5,
      'technical.tackling': 0.5,
      'technical.passing': 0.5,
      'technical.shooting': -1,
      'physical.pace': -0.5,
    },
  },
];

const PERSONALITIES: Array<{ value: Personality; weight: number }> = [
  { value: 'Quiet', weight: 8 },
  { value: 'Laid back', weight: 10 },
  { value: 'Confident', weight: 9 },
  { value: 'Talkative', weight: 8 },
  { value: 'Competitive', weight: 10 },
  { value: 'Wind-up merchant', weight: 4 },
  { value: 'Model pro', weight: 6 },
  { value: 'Hot-headed', weight: 5 },
  { value: 'Joker', weight: 6 },
  { value: 'Reliable sort', weight: 9 },
];

type Buckets = Record<string, Record<string, number>>;

function blankBuckets(): Buckets {
  return { technical: {}, physical: {}, mental: {}, behavioural: {}, hidden: {} };
}

function setKey(buckets: Buckets, flatKey: string, value: number): void {
  const [group, attr] = flatKey.split('.');
  if (!group || !attr || !buckets[group]) return;
  buckets[group]![attr] = clampAttribute(value);
}

const BASE_KEYS = [
  'technical.passing', 'technical.shooting', 'technical.tackling', 'technical.ballControl',
  'technical.crossing', 'technical.heading', 'technical.goalkeeping',
  'physical.pace', 'physical.stamina', 'physical.strength', 'physical.agility',
  'mental.positioning', 'mental.decisions', 'mental.composure', 'mental.workRate',
  'mental.determination', 'behavioural.commitment', 'behavioural.discipline',
  'behavioural.ambition', 'behavioural.loyalty', 'behavioural.reliability',
  'hidden.consistency', 'hidden.adaptability', 'hidden.pressureResponse',
  'hidden.tacticalIntelligence', 'hidden.injurySusceptibility', 'hidden.temperament',
];

function buildAttributes(rng: Rng, archetype: PlayerArchetype, quality: number, age: number): PlayerAttributes {
  const buckets = blankBuckets();

  // Age curve: young players are raw (lower mental/positioning), older players
  // lose pace but gain nous. Sunday League ages span a wide range.
  const youthPenalty = age < 20 ? (20 - age) * 0.55 : 0;
  const agePenalty = age > 32 ? (age - 32) * 0.6 : 0;

  for (const key of BASE_KEYS) {
    let value = rng.gaussian(quality, 2.1) + (archetype.attrs[key] ?? 0) * 0.35;
    if (key === 'mental.positioning' || key === 'mental.decisions' || key === 'hidden.tacticalIntelligence') {
      value -= youthPenalty;
      value += agePenalty * 0.5;
    }
    if (key === 'physical.pace' || key === 'physical.agility') {
      value -= agePenalty;
      value += youthPenalty * 0.4;
    }
    if (key === 'physical.stamina') value -= agePenalty * 0.6;
    if (key === 'mental.composure' || key === 'hidden.pressureResponse') {
      value += agePenalty * 0.4 - youthPenalty * 0.3;
    }
    setKey(buckets, key, value);
  }

  // Overlay the archetype's signature: the shape of the player.
  for (const [key, offset] of Object.entries(archetype.attrs)) {
    const [group, attr] = key.split('.');
    if (!group || !attr) continue;
    const current = buckets[group]?.[attr] ?? quality;
    setKey(buckets, key, current + rng.gaussian(offset, 1.1));
  }

  // Behavioural traits are deliberately independent of ability. Talented but
  // unreliable players are a defining feature of Sunday League football.
  setKey(buckets, 'behavioural.reliability', rng.gaussian(quality, 3.4));
  setKey(buckets, 'behavioural.commitment', rng.gaussian(quality, 3.2));
  setKey(buckets, 'behavioural.discipline', rng.gaussian(quality, 2.8));
  setKey(buckets, 'hidden.injurySusceptibility', rng.gaussian(10, 3.2));
  setKey(buckets, 'hidden.consistency', rng.gaussian(quality, 3));

  if (archetype.group === 'GK') {
    setKey(buckets, 'technical.goalkeeping', Math.max(quality + 3.5, rng.gaussian(quality + 0.5, 1.6)));
  } else {
    // Outfielders can still pull on the gloves in an emergency, badly.
    setKey(buckets, 'technical.goalkeeping', rng.gaussian(3, 1.2));
  }

  return buckets as unknown as PlayerAttributes;
}

function buildFamiliarity(
  rng: Rng,
  preferred: PositionCode,
  profile: PlayerArchetype,
): Partial<Record<PositionCode, number>> {
  const familiarity: Partial<Record<PositionCode, number>> = {};
  for (const code of ALL_POSITION_CODES) {
    if (code === preferred) {
      familiarity[code] = 20;
      continue;
    }
    const similarity = positionalSimilarity(preferred, code);
    if (similarity < 0.4) continue; // Never played there: left unknown.
    const base = Math.round(similarity * 14);
    familiarity[code] = Math.max(3, Math.min(17, base + rng.int(-2, 2)));
  }
  // Utility players genuinely know several roles.
  if (profile.id === 'utility-player') {
    for (const code of profile.preferred) {
      familiarity[code] = Math.max(familiarity[code] ?? 0, rng.int(12, 16));
    }
  }
  return familiarity;
}

let idCounter = 0;

export function nextPlayerId(seedKey: string): PlayerId {
  idCounter += 1;
  return `p_${seedKey}_${idCounter}`;
}

/** Reset the id counter — used by tests and by fresh game creation. */
export function resetPlayerIdCounter(): void {
  idCounter = 0;
}

export interface GeneratePlayerOptions {
  rng: Rng;
  id: PlayerId;
  clubId: ClubId | null;
  townId: TownId | null;
  homeGroundId: GroundId | null;
  /** Expected mean attribute value for the squad, e.g. 10.5. */
  quality: number;
  seasonStart: ISODate;
  /** Force a specific role (used to fill squad quotas). */
  positionGroup?: PositionGroup;
  age?: number;
}

export function generatePlayer(options: GeneratePlayerOptions): Player {
  const { rng, quality, seasonStart } = options;
  const pool = options.positionGroup ? ARCHETYPES.filter((a) => a.group === options.positionGroup) : ARCHETYPES;
  const archetype = rng.weighted(pool.map((a) => ({ value: a, weight: a.weight })));
  // An archetype may list secondary roles in other areas of the pitch (a target
  // man who can also play attacking midfield). When the caller asked for a
  // specific area, honour it so squad shapes stay accurate.
  const allowed = options.positionGroup
    ? archetype.preferred.filter((code) => POSITIONS[code].group === options.positionGroup)
    : archetype.preferred;
  const preferred = rng.pick(allowed.length > 0 ? allowed : archetype.preferred);
  const age = options.age ?? rollAge(rng, preferred);
  const attributes = buildAttributes(rng, archetype, quality, age);
  const personality = rng.weighted(PERSONALITIES.map((p) => ({ value: p.value, weight: p.weight })));

  const heightBase =
    POSITIONS[preferred].group === 'GK' ? 183 : POSITIONS[preferred].group === 'DEF' ? 180 : 176;
  const strength = (attributes.physical as unknown as Record<string, number>).strength ?? 10;
  const heightCm = Math.round(rng.gaussian(heightBase + (strength - 10) * 1.6, 5));

  const familiarityOffset = playerFamiliarityOffset(rng, age);

  const record: PlayerRecord = {
    appearances: 0,
    substituteAppearances: 0,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    seasons: [],
  };

  return {
    id: options.id,
    kind: 'player',
    firstName: personFirstName(rng),
    surname: personSurname(rng),
    nickname: maybeNickname(rng),
    age,
    townId: options.townId,
    occupation: occupationForAge(rng, age),
    reputation: Math.round(Math.max(5, Math.min(95, (quality - 6) * 9 + rng.gaussian(0, 12)))),
    roles: options.clubId ? [{ clubId: options.clubId, role: 'player', since: seasonStart }] : [],
    clubId: options.clubId,
    registered: options.clubId !== null,
    heightCm,
    preferredPosition: preferred,
    positionGroup: POSITIONS[preferred].group,
    positionalFamiliarity: buildFamiliarity(rng, preferred, archetype),
    // How well he knows *this club's* way of playing. Deliberately around the
    // middle of the scale: an ordinary squad in a fresh world sits at neutral,
    // and everything after this is what the club teaches him on a Thursday.
    systemFamiliarity: createSystemFamiliarity({
      formation: 10 + familiarityOffset.formation,
      instructions: 10 + familiarityOffset.instructions,
      setPieces: 10 + familiarityOffset.setPieces,
    }),
    attributes,
    // On a stream of its own, keyed to the player rather than to the squad's
    // shared one: giving a lad a ceiling must not shift the roll that decided
    // the abilities of the twenty men around him.
    development: developmentProfileFor(new Rng(`${options.id}::development-curve`), quality, age),
    personality,
    fitness: rng.int(88, 100),
    form: rng.gaussianInt(50, 9, 20, 85),
    morale: rng.gaussianInt(68, 10, 35, 95),
    availability: { status: 'available', reason: null, note: null, until: null, discoveredLate: false },
    injury: null,
    homeGroundId: options.homeGroundId,
    isPlayerManager: false,
    joinedClubOn: seasonStart,
    record,
    notes: [],
    subs: emptyPlayerSubs(),
  };
}

/**
 * The age a player stops having room to grow. After this he is the man he is.
 */
export const DEVELOPMENT_LAST_AGE = 24;

/**
 * The shape of a player's career: how good he can get, and when.
 *
 * A player gets headroom while he is young, in proportion to how young he is,
 * and none at all once he is a grown man. That is the whole incentive the
 * simulation offers a manager — a teenager you get right is worth more than a
 * thirty-year-old you sign — and it is deliberately keyed to age rather than to
 * the gap to a player's peak. Keying it to the peak instead gives almost every
 * player in a league whose average age is its average peak no room at all,
 * which silently switches development off across the whole world.
 *
 * `quality` is the level he was generated at, so a Division One intake is
 * drawn with a higher ceiling than a Division Three one without either of them
 * being handed a head start.
 */
export function developmentProfileFor(rng: Rng, quality: number, age: number): PlayerDevelopment {
  const peakAge = 24 + rng.int(0, 7);
  // A lad gets a little more out of each year than the arithmetic suggests,
  // because the first improvements in a career are the big ones.
  const yearsOfYouth = Math.max(0, DEVELOPMENT_LAST_AGE - age);
  const room = yearsOfYouth * 0.45 + rng.gaussian(0, 0.3);
  const potential = Math.max(quality, Math.min(20, quality + room));
  return {
    potential: Math.round(potential * 10) / 10,
    peakAge,
  };
}

/**
 * A small, age-aware spread on top of the neutral familiarity, so squads are
 * not all identical: older players have been around the block, raw teenagers
 * have not.
 */
function playerFamiliarityOffset(rng: Rng, age: number): { formation: number; instructions: number; setPieces: number } {
  const ageBump = age >= 32 ? 1.4 : age >= 27 ? 0.7 : age <= 20 ? -1.1 : 0;
  return {
    formation: rng.gaussian(ageBump, 2.4),
    instructions: rng.gaussian(ageBump, 2.2),
    setPieces: rng.gaussian(ageBump * 0.5, 2.6),
  };
}

function rollAge(rng: Rng, preferred: PositionCode): number {
  // Keepers and centre halves tend to be older; wingers tend to be younger.
  const offsets: Record<PositionCode, number> = {
    GK: 3, CB: 2, RB: 0, LB: 0, DM: 1.5, CM: 0.5, RM: -0.5, LM: -0.5, AM: -0.5, RW: -1.5, LW: -1.5, ST: 0,
  };
  return rng.gaussianInt(26.5 + offsets[preferred], 4.6, 17, 42);
}

const SQUAD_DEPTH: Array<{ group: PositionGroup; mean: number; min: number }> = [
  { group: 'GK', mean: 2.4, min: 2 },
  { group: 'DEF', mean: 7.2, min: 5 },
  { group: 'MID', mean: 8.0, min: 6 },
  { group: 'FWD', mean: 5.2, min: 4 },
];

export interface GenerateSquadOptions {
  rng: Rng;
  clubId: ClubId;
  townId: TownId;
  homeGroundId: GroundId;
  quality: number;
  seasonStart: ISODate;
  idSeedPrefix: string;
  /** Target squad size; generated squads land in the 20-25 range. */
  size?: number;
}

/**
 * Squads are generated to a *shape* (keepers, defenders, midfielders,
 * forwards) rather than a fixed list, then topped up, so squads are believable
 * but never identical.
 */
export function generateSquad(options: GenerateSquadOptions): Player[] {
  const { rng, clubId, quality, seasonStart } = options;
  const target = options.size ?? rng.int(20, 25);

  const shape = SQUAD_DEPTH.map((entry) => ({
    group: entry.group,
    min: entry.min,
    count: Math.max(entry.min, rng.gaussianInt(entry.mean, 0.9, entry.min, 11)),
  }));

  let total = shape.reduce((sum, entry) => sum + entry.count, 0);
  while (total > target) {
    const reducible = shape.filter((entry) => entry.count > entry.min);
    if (reducible.length === 0) break;
    rng.pick(reducible).count -= 1;
    total -= 1;
  }
  while (total < target) {
    rng.pick(shape.slice(1)).count += 1;
    total += 1;
  }

  const players: Player[] = [];
  for (const entry of shape) {
    for (let i = 0; i < entry.count; i++) {
      const index = players.length + 1;
      players.push(
        generatePlayer({
          rng,
          id: `${options.idSeedPrefix}_p${index}`,
          clubId,
          townId: options.townId,
          homeGroundId: options.homeGroundId,
          quality: quality + rng.gaussian(0, 1.1),
          seasonStart,
          positionGroup: entry.group,
        }),
      );
    }
  }

  return players;
}
