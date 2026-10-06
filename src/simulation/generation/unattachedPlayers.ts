import type { GameState } from '@/domain/game';
import type { ISODate, PlayerId, TownId } from '@/domain/ids';
import { isPlayer, type Player } from '@/domain/person';
import type { PositionGroup } from '@/domain/positions';
import type { Town } from '@/domain/world';
import { Rng, stream } from '../rng';
import { removePersonFromCommunication } from '../communication/store';
import { removePersonRelationships } from '../relationships';
import { generatePlayer } from './playerGenerator';

/**
 * The unattached pool.
 *
 * Every plausible local football world contains lads who are not playing this
 * season: they have packed in a Saturday side, moved to the area, fallen out
 * with a club, or never got round to finding a team. They are ordinary people
 * in the world, not a free-agent database — they exist in towns, they know
 * people, and they are only ever found through other people and football
 * activity.
 */

const REASONS = [
  'Packed in his Saturday side and fancies Sundays.',
  'Moved to the area over the summer.',
  'Playing five-a-side only at the moment.',
  'Fell out with his old club.',
  'Taking a season off — or so he says.',
  'Wants to play nearer home.',
  'His old team folded.',
  'Into the area for work for the next year.',
  'Wants a game where he actually starts.',
  'Playing with his mates in a casual league.',
  'Looking for a proper Sunday team again.',
];

const GROUP_WEIGHTS: Array<{ value: PositionGroup; weight: number }> = [
  { value: 'GK', weight: 1.1 },
  { value: 'DEF', weight: 2.6 },
  { value: 'MID', weight: 2.6 },
  { value: 'FWD', weight: 2 },
];

/**
 * How many men without a club the county can hold, per club in it.
 *
 * A Sunday league county of thirty-six clubs is a few thousand players; the men
 * in it who are good enough to be wanted and currently wanted by nobody are a
 * small fraction of that. The first season of the standard soak opens with a pool
 * of thirty-seven, so this is set to hold a pool of about that size — the drift
 * band is ±35% and a cap set here is what the band is holding the world to.
 */
export const POOL_PER_CLUB = 0.8;

function qualityForTown(rng: Rng, town: Town): number {
  // A strong town club's standard is around 11-12; the unattached pool is a
  // little below that but includes the occasional genuine player.
  const size = Math.min(1, Math.max(0, Math.log10(Math.max(200, town.population) / 200) / 1.8));
  return Math.max(6.8, Math.min(13.2, 8.5 + size * 2.1 + rng.gaussian(0, 1.3)));
}

function rollAge(rng: Rng): number {
  return rng.weighted([
    { value: 19, weight: 2 },
    { value: 23, weight: 3 },
    { value: 27, weight: 3 },
    { value: 31, weight: 2.2 },
    { value: 35, weight: 1.2 },
    { value: 38, weight: 0.6 },
  ]);
}

export interface GenerateUnattachedOptions {
  seed: string;
  towns: Town[];
  date: ISODate;
  /** Prefix for generated ids so different seasons never collide. */
  idPrefix: string;
  /** Inclusive range of players created per town. */
  perTown?: [number, number];
  /** Extra known names for the pool — used by tests. */
  townFilter?: TownId[];
}

export function generateUnattachedPlayers(options: GenerateUnattachedOptions): Player[] {
  const towns = options.townFilter
    ? options.towns.filter((town) => options.townFilter!.includes(town.id))
    : options.towns;
  const [minPerTown, maxPerTown] = options.perTown ?? [2, 4];
  const players: Player[] = [];
  let index = 0;

  for (const town of towns) {
    const rng = stream(options.seed, 'unattached', options.idPrefix, town.id);
    const count = rng.int(minPerTown, maxPerTown);
    for (let i = 0; i < count; i++) {
      index += 1;
      const quality = qualityForTown(rng, town);
      const group = rng.weighted(GROUP_WEIGHTS);
      const player = generatePlayer({
        rng,
        id: `free_${options.idPrefix}_${index}` as PlayerId,
        clubId: null,
        townId: town.id,
        homeGroundId: null,
        quality,
        seasonStart: options.date,
        positionGroup: group,
        age: Math.max(17, Math.min(41, Math.round(rollAge(rng) + rng.gaussian(0, 3.4)))),
      });
      player.notes = [rng.pick(REASONS)];
      players.push(player);
    }
  }

  return players;
}

/**
 * Keep the unattached pool alive across seasons: everybody gets a year older,
 * the oldest drift out of the local game, and a few new names appear.
 *
 * The pool is also *capped*, and that cap is what keeps it a market rather than a
 * reservoir. Every summer some men are released by their clubs and some new
 * names turn up, and the only way out of the pool is being signed — so with
 * nothing to stop it the pool grew by a dozen a season and more than tripled over
 * a decade, while every squad stayed exactly as full as it always was. In a
 * county this size there are only so many men playing football without a club;
 * past that number the surplus have given up and gone to five-a-side, or moved
 * away, or simply stopped. Which is what the surplus are treated as doing here.
 */
export function refreshUnattachedPool(state: GameState, seasonStart: ISODate, idPrefix: string): Player[] {
  const unattached = Object.values(state.people).filter(
    (person): person is Player => isPlayer(person) && person.clubId === null,
  );
  const departed: Player[] = [];

  for (const player of unattached) {
    player.age += 1;
    player.fitness = 100;
    player.form = 50;
    player.injury = null;
    if (player.age >= 41 || (player.age >= 38 && player.attributes.physical.pace <= 5)) departed.push(player);
  }

  // The surplus over the cap go as well, oldest and weakest first. Counting them
  // against the cap is deliberate: they were in the pool this morning, and they
  // are the reason the pool is no bigger than it is.
  const clubCount = Object.values(state.clubs).filter((club) => club.active).length;
  const cap = Math.max(12, Math.round(clubCount * POOL_PER_CLUB));
  const staying = unattached.filter((player) => !departed.includes(player));
  if (staying.length > cap) {
    const surplus = [...staying]
      .sort((a, b) => b.age - a.age || a.id.localeCompare(b.id))
      .slice(0, staying.length - cap);
    departed.push(...surplus);
  }

  for (const player of departed) {
    delete state.people[player.id];
    // A man who leaves the world should not leave his relationships or his
    // correspondence behind: the save loader would prune both on the next load,
    // so a running career and a reloaded one would otherwise differ.
    removePersonRelationships(state, player.id);
    removePersonFromCommunication(state, player.id);
    for (const candidateId of Object.keys(state.recruitment?.candidates ?? {})) {
      if (candidateId === player.id) delete state.recruitment.candidates[candidateId];
    }
  }

  const arrivals = generateUnattachedPlayers({
    seed: state.seed,
    towns: Object.values(state.world.towns),
    date: seasonStart,
    idPrefix,
    perTown: [0, 2],
  });
  for (const player of arrivals) {
    if (state.people[player.id]) continue;
    state.people[player.id] = player;
  }
  return arrivals;
}

/** Everybody who is not currently registered with a club. */
export function unattachedPlayers(state: GameState): Player[] {
  return Object.values(state.people).filter(
    (person): person is Player => isPlayer(person) && person.clubId === null,
  );
}