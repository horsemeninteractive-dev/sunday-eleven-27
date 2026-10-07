import { hashString } from './rng';

/**
 * One of several readings of the same fact.
 *
 * The world is full of things that only have one sentence written for them — a
 * goal, a booking, a club going into the red — and a career that reads the same
 * sentence every week reads as a spreadsheet rather than as a season. This is
 * how a writer says the same thing several ways without giving up determinism.
 *
 * The choice is a hash of *the thing being described*, never a roll of the dice,
 * because prose in this game is written twice for the same fact: a match is
 * replayed from its record and a news item is re-rendered on the way into the
 * inbox. The same event must read the same way every time it is read, and two
 * different events must not.
 *
 * `key` should be the identity of the fact — an event id, a match id and the
 * minute, a player id and a date — so the phrase varies *between* facts. Where
 * one fact needs two independent choices, give the second one its own key with a
 * label on the end (`${event.id}:body`), or the two choices move together and
 * the pairing repeats.
 */
export function variant(pool: readonly string[], key: string): string {
  if (pool.length === 0) throw new Error('variant called with an empty pool');
  return pool[hashString(key) % pool.length]!;
}

/**
 * How many different readings a pool can produce for a list of keys.
 *
 * Only used by the tests that hold the prose to its promises: a pool a career
 * never actually varies is the bug this module exists to prevent, and counting
 * the distinct readings says so without pinning any particular sentence.
 */
export function readings(pool: readonly string[], keys: readonly string[]): Set<string> {
  return new Set(keys.map((key) => variant(pool, key)));
}
