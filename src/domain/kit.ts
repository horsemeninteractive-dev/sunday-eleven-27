/**
 * The club's kit.
 *
 * A Sunday league club is its shirt. It is the only thing about the club that
 * everybody in the town can describe — "the ones in the red and white stripes" —
 * and it is where the money and the names meet: the crest on the left breast,
 * the kit firm's mark on the right, and a local business across the chest.
 *
 * Kits are generated rather than drawn, like badges and grounds, and they are
 * generated *per season*: every summer the club's kit deal is up, the sponsor
 * reviews it, and the manager is offered a few designs to pick from. Nothing
 * about a kit is stored in the save beyond which design he chose, so a career
 * rolls into a new season with a new strip without a single field to migrate.
 */

/** How the shirt is patterned. The pattern is always drawn in the second colour. */
export type KitPattern =
  | 'plain'
  | 'stripes'
  | 'pinstripes'
  | 'hoops'
  | 'halves'
  | 'quarters'
  | 'sash'
  | 'chevron'
  | 'yoke';

export const KIT_PATTERNS: KitPattern[] = [
  'plain',
  'stripes',
  'pinstripes',
  'hoops',
  'halves',
  'quarters',
  'sash',
  'chevron',
  'yoke',
];

export const KIT_PATTERN_LABEL: Record<KitPattern, string> = {
  plain: 'plain',
  stripes: 'stripes',
  pinstripes: 'pinstripes',
  hoops: 'hoops',
  halves: 'halves',
  quarters: 'quarters',
  sash: 'a sash',
  chevron: 'a chevron',
  yoke: 'a shoulder yoke',
};

/** The shirt's neckline. Collars and cuffs share the trim colour. */
export type KitCollar = 'crew' | 'v' | 'grandad';

export const KIT_COLLARS: KitCollar[] = ['crew', 'v', 'grandad'];

export const KIT_COLLAR_LABEL: Record<KitCollar, string> = {
  crew: 'crew neck',
  v: 'V-neck',
  grandad: 'grandad collar',
};

/** Which of the three strips a shirt belongs to. */
export type KitRole = 'home' | 'away' | 'goalkeeper';

export const KIT_ROLES: KitRole[] = ['home', 'away', 'goalkeeper'];

export const KIT_ROLE_LABEL: Record<KitRole, string> = {
  home: 'Home',
  away: 'Away',
  goalkeeper: 'Goalkeeper',
};

/** The device on a kit firm's mark. Purely a shape; the name carries the rest. */
export type KitMark = 'chevron' | 'wing' | 'bolt' | 'arc' | 'rosette' | 'pennant' | 'tick' | 'crown' | 'flame' | 'orbit';

/** A kit firm. Fictional, and deliberately small-time. */
export interface KitMaker {
  id: string;
  name: string;
  mark: KitMark;
}

/**
 * The name across the chest.
 *
 * Usually the club's own pub or a local firm; sometimes nobody, which is still
 * common at this level and is drawn as an empty chest rather than faked.
 */
export interface KitSponsor {
  id: string;
  name: string;
  /** Set when the sponsor is a business in the world, so the two agree. */
  businessId: string | null;
}

/** One strip: the shirt, the shorts and the socks, and how they are coloured. */
export interface KitDesign {
  role: KitRole;
  pattern: KitPattern;
  collar: KitCollar;
  /** The shirt's body colour. */
  primary: string;
  /** The pattern's colour. */
  secondary: string;
  /** Collar, cuffs and the shorts' waistband. */
  trim: string;
  /** Ink for the sponsor's name and the maker's mark on the shirt. */
  ink: string;
  shorts: string;
  shortsTrim: string;
  socks: string;
  socksTrim: string;
}

/** Everything the club will run out in this season. */
export interface KitSet {
  /** The season it was made for. A new label means a new kit. */
  season: string;
  /** Which of the offered designs this is. */
  option: number;
  maker: KitMaker;
  sponsor: KitSponsor | null;
  home: KitDesign;
  away: KitDesign;
  goalkeeper: KitDesign;
}

export function designFor(kit: KitSet, role: KitRole): KitDesign {
  return role === 'home' ? kit.home : role === 'away' ? kit.away : kit.goalkeeper;
}

/** "Ferrow · the Old White Hart" — the short version, for a subtitle or a list. */
export function kitCredit(kit: KitSet): string {
  return kit.sponsor ? `${kit.maker.name} · ${kit.sponsor.name}` : `${kit.maker.name} · no shirt sponsor`;
}
