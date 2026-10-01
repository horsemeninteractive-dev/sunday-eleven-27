/**
 * The badge a club wears.
 *
 * Almost every club in the world has its badge drawn for it by the generator:
 * a silhouette, a pattern in the club's two colours, and a symbol that means
 * something about the name. A club the manager builds is the one case where
 * somebody else has an opinion, so the choices live here — they are part of
 * what the club *is*, which is why they are stored on the club and not kept in
 * the drawing code.
 *
 * Every field is optional. A club that leaves one alone wears whatever the
 * generator would have given it, which is what every club in the world does,
 * and a club that has never been near a designer carries no badge at all.
 */

export type BadgeShape = 'shield' | 'roundel' | 'oval' | 'arch' | 'pennant';

export type BadgePattern =
  | 'plain'
  | 'stripes'
  | 'hoops'
  | 'halves'
  | 'quarters'
  | 'sash'
  | 'chevron'
  | 'pinstripes';

/** The symbol a badge carries. Each one means something about the club. */
export type BadgeDevice =
  | 'ball'
  | 'stag'
  | 'lion'
  | 'horse'
  | 'bull'
  | 'ram'
  | 'fox'
  | 'hound'
  | 'badger'
  | 'bird'
  | 'swan'
  | 'sheaf'
  | 'tree'
  | 'rose'
  | 'crown'
  | 'ship'
  | 'anchor'
  | 'keys'
  | 'bell'
  | 'plough'
  | 'barrels'
  | 'hop'
  | 'wheel'
  | 'sun'
  | 'star'
  | 'anvil'
  | 'tower'
  | 'bridge'
  | 'castle'
  | 'chequers'
  | 'bolt'
  | 'laurel'
  | 'cross'
  | 'trowel';

/** What a manager decided about his own club's badge, if he decided anything. */
export interface BadgeChoice {
  shape?: BadgeShape;
  pattern?: BadgePattern;
  device?: BadgeDevice;
}

/**
 * The choice with the fields nobody touched left out.
 *
 * An undecided field is stored as nothing rather than as an empty value, so the
 * drawing code has one question to ask — "was a choice made?" — and a career
 * saved today reads the same as one saved before the designer existed.
 */
export function compactBadge(choice: BadgeChoice | undefined): BadgeChoice | undefined {
  if (!choice) return undefined;
  const compact: BadgeChoice = {};
  if (choice.shape) compact.shape = choice.shape;
  if (choice.pattern) compact.pattern = choice.pattern;
  if (choice.device) compact.device = choice.device;
  return compact.shape || compact.pattern || compact.device ? compact : undefined;
}
