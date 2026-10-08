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

/**
 * The silhouette a badge is cut to.
 *
 * Five of these were enough for a while, and a county of forty clubs looked
 * like five badges between them. Every silhouette here is plain enough to be
 * read at 18px in a league table — that is the whole test of one — and each is
 * shaped so the name band is still the full width of the badge at the height
 * the letters sit, which is why there is no pointed-topped shape among them.
 */
export type BadgeShape =
  | 'shield'
  | 'roundel'
  | 'oval'
  | 'arch'
  | 'pennant'
  | 'octagon'
  | 'plaque'
  | 'swallowtail'
  | 'gable'
  | 'ovalWide';

export type BadgePattern =
  | 'plain'
  | 'stripes'
  | 'hoops'
  | 'halves'
  | 'quarters'
  | 'sash'
  | 'chevron'
  | 'pinstripes'
  // The heraldic three, added as the field library grew. A bordure is the one
  // every real badge has and this generator did not: an edge band in the second
  // colour, which is why the crests of the county stopped looking flat.
  | 'bordure'
  | 'saltire'
  | 'perFess';

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
  | 'trowel'
  | 'gate'
  | 'well'
  | 'beehive'
  | 'fish'
  | 'arrow'
  | 'lamp'
  | 'hammer'
  | 'mallet'
  | 'mitre'
  | 'chalice'
  | 'vine'
  | 'millstone'
  | 'spade'
  | 'sword'
  // The third wave: the birds that were all one bird, the creatures of the pub
  // signs, and the mill and the pick a local club is named after. Appending
  // here rather than folding them into the middle of the table keeps every
  // crest that clubs already wear exactly where it was.
  | 'eagle'
  | 'owl'
  | 'peacock'
  | 'dolphin'
  | 'hare'
  | 'boar'
  | 'bear'
  | 'unicorn'
  | 'griffin'
  | 'dragon'
  | 'windmill'
  | 'fleece'
  | 'pickaxe';

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
