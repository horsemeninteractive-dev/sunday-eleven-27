import type { Club } from '@/domain/club';
import {
  KIT_COLLARS,
  type KitDesign,
  type KitMaker,
  type KitPattern,
  type KitRole,
  type KitSet,
  type KitSponsor,
} from '@/domain/kit';
import type { GameState } from '@/domain/game';
import type { ClubId } from '@/domain/ids';
import type { Business } from '@/domain/world';
import { stream, type Rng, type WeightedEntry } from '@/simulation/rng';
import { colourDistance, contrastRatio, DARK_INK, inkForColour, inkForColours, LIGHT_INK, mixColours } from './colour';

/**
 * Club kits, planned rather than illustrated.
 *
 * Where a badge is a club's identity, a kit is its *wardrobe*: a club has three
 * strips, a maker and a sponsor, and all of it changes when the season does.
 * Everything below is a decision about colours and shapes; `components/Kit.tsx`
 * only turns the result into SVG, exactly as `badge.ts` and `Badge.tsx` split
 * the same job for crests.
 *
 * Two rules hold the whole thing together:
 *
 *  - The home shirt is the club's own colours. Nobody in this world wears a
 *    home kit that is not their two colours, so the generator never invents
 *    them: it only decides how to arrange them.
 *  - A strip has to be tellable from another one. The away and goalkeeper kits
 *    are drawn from the local game's usual palette and are only allowed if they
 *    are far enough from what the club already wears.
 */

/** How many designs the club is offered each summer. */
export const KIT_OPTION_COUNT = 3;

/**
 * How different two strips have to look before one can stand in for the other,
 * on the same channel-weighted scale `colourDistance` uses (0-765).
 */
export const MIN_KIT_DISTANCE = 150;

/**
 * The kit firms of the local game.
 *
 * Small, British-sounding and invented: a Sunday league club's kit deal is with
 * a firm nobody outside the county has heard of, and often with one that prints
 * the shirts in a unit on an estate.
 */
export const KIT_MAKERS: KitMaker[] = [
  { id: 'ferrow', name: 'Ferrow', mark: 'chevron' },
  { id: 'bramwell', name: 'Bramwell', mark: 'wing' },
  { id: 'tomlin', name: 'Tomlin Sports', mark: 'tick' },
  { id: 'vantage', name: 'Vantage', mark: 'bolt' },
  { id: 'calder', name: 'Calder & Sons', mark: 'arc' },
  { id: 'redmayne', name: 'Redmayne', mark: 'rosette' },
  { id: 'hartsmere', name: 'Hartsmere', mark: 'pennant' },
  { id: 'progress', name: 'Progress Kit', mark: 'crown' },
  { id: 'colney', name: 'Colney Sport', mark: 'orbit' },
  { id: 'marlowe', name: 'Marlowe', mark: 'flame' },
];

/**
 * What a club wears when it cannot wear its own colours. Deliberately the
 * colours of the local game: white, black, navy, and a lot of red and yellow.
 */
const CHANGE_COLOURS_RAW: string[] = [
  '#ffffff',
  '#f2f2ee',
  '#111111',
  '#20242b',
  '#16224a',
  '#1d4ed8',
  '#7fa8d4',
  '#f2c200',
  '#c62828',
  '#8c1d3f',
  '#146b3a',
  '#4b7f52',
  '#5b5b5b',
  '#3b2a52',
  '#d9700f',
  '#e0e3e8',
];

/** Goalkeepers wear the loudest shirt on the field. */
const KEEPER_COLOURS_RAW: string[] = [
  '#f9a825',
  '#2e7d32',
  '#6a1b9a',
  '#c2185b',
  '#00838f',
  '#ef6c00',
  '#4527a0',
  '#558b2f',
  '#ad1457',
  '#00695c',
  '#d84315',
  '#7cb342',
];

/**
 * Colours a name can actually be printed on.
 *
 * A shirt body is a background for somebody's business name, so a colour that
 * neither ink clears 4.5:1 against is not a colour this game will put on a
 * shirt. The club's *own* colours are the club's business and are left alone;
 * the ones the generator chooses are filtered through here.
 */
function printablePool(pool: string[]): string[] {
  const printable = pool.filter(
    (colour) => Math.max(contrastRatio(LIGHT_INK, colour), contrastRatio(DARK_INK, colour)) >= 4.5,
  );
  return printable.length > 0 ? printable : pool;
}

const PRINTABLE_CHANGE_COLOURS = printablePool(CHANGE_COLOURS_RAW);
const PRINTABLE_KEEPER_COLOURS = printablePool(KEEPER_COLOURS_RAW);

/* Weights: what clubs at this level actually wear. Plenty of plain shirts,
   plenty of stripes, and the more elaborate patterns kept rare. */
const HOME_PATTERNS: Array<WeightedEntry<KitPattern>> = [
  { value: 'stripes', weight: 4 },
  { value: 'plain', weight: 3 },
  { value: 'pinstripes', weight: 2 },
  { value: 'hoops', weight: 2 },
  { value: 'yoke', weight: 1.2 },
  { value: 'halves', weight: 1.2 },
  { value: 'quarters', weight: 1 },
  { value: 'chevron', weight: 0.7 },
  { value: 'sash', weight: 0.6 },
];

const AWAY_PATTERNS: Array<WeightedEntry<KitPattern>> = [
  { value: 'plain', weight: 4 },
  { value: 'pinstripes', weight: 2 },
  { value: 'halves', weight: 1.5 },
  { value: 'yoke', weight: 1.5 },
  { value: 'chevron', weight: 1 },
  { value: 'sash', weight: 1 },
  { value: 'hoops', weight: 0.6 },
  { value: 'stripes', weight: 0.6 },
  { value: 'quarters', weight: 0.5 },
];

const KEEPER_PATTERNS: Array<WeightedEntry<KitPattern>> = [
  { value: 'plain', weight: 5 },
  { value: 'yoke', weight: 2.5 },
  { value: 'halves', weight: 1.5 },
  { value: 'chevron', weight: 1.2 },
  { value: 'sash', weight: 0.6 },
  { value: 'hoops', weight: 0.6 },
  { value: 'pinstripes', weight: 0.6 },
  { value: 'stripes', weight: 0.3 },
  { value: 'quarters', weight: 0.4 },
];

export interface KitRequest {
  seed: string;
  clubId: string;
  seasonLabel: string;
  colours: { primary: string; secondary: string };
  sponsor: KitSponsor | null;
}

/**
 * The club's sponsor, as the shirt shows it.
 *
 * A pub-backed club wears the pub that owns it, which is why so many shirts in
 * this world carry the name the club itself is named after. A club with nobody
 * behind it gets nothing: an empty chest is honest, and common.
 */
export function sponsorFromBusiness(business: Business | null | undefined): KitSponsor | null {
  if (!business) return null;
  return { id: business.id, name: business.name, businessId: business.id };
}

/** Just the maker for a season — the kit deal does not change with the design. */
function makerFor(rng: Rng): KitMaker {
  return rng.pick(KIT_MAKERS);
}

function partnerFor(rng: Rng, base: string, pool: string[]): string {
  const options = pool.filter((colour) => colourDistance(colour, base) >= MIN_KIT_DISTANCE);
  if (options.length > 0) return rng.pick(options);
  // Nothing in the pool is far enough away: darken or lighten the base instead.
  return rng.chance(0.5) ? mixColours(base, '#000000', 0.5) : mixColours(base, '#ffffff', 0.55);
}

/**
 * The club's second colour, made usable.
 *
 * Two colours that are almost the same cannot make a pattern — the stripes
 * vanish — so a club whose colours sit on top of each other is given a working
 * pattern colour derived from its first. The shirt still reads as the club.
 */
function patternColour(primary: string, secondary: string): string {
  if (colourDistance(primary, secondary) >= 90) return secondary;
  return inkForColour(primary) === '#f4f8f6'
    ? mixColours(primary, '#ffffff', 0.45)
    : mixColours(primary, '#000000', 0.4);
}

function withPattern(
  pattern: KitPattern,
  primary: string,
  secondary: string,
): { pattern: KitPattern; secondary: string } {
  if (pattern === 'plain') return { pattern, secondary };
  if (colourDistance(primary, secondary) < 90) return { pattern: 'plain', secondary };
  return { pattern, secondary };
}

function weightsFor(role: KitRole): Array<WeightedEntry<KitPattern>> {
  return role === 'home' ? HOME_PATTERNS : role === 'away' ? AWAY_PATTERNS : KEEPER_PATTERNS;
}

/**
 * One strip.
 *
 * `change` is the colour the strip is built around; for the home shirt that is
 * the club's own first colour, and the pattern is its second. The shorts and
 * socks are decided with it, because a kit is a set: the local game is full of
 * clubs in red shirts, black shorts and red socks.
 */
function designFor(
  rng: Rng,
  role: KitRole,
  main: string,
  patternSource: string,
  inkSource: string,
): KitDesign {
  const patternChoice = rng.weighted(weightsFor(role));
  const built = withPattern(patternChoice, main, patternSource);
  const trim = built.pattern === 'plain' ? patternSource : built.secondary;
  const shorts = rng.chance(0.62) ? main : patternSource;
  return {
    role,
    pattern: built.pattern,
    collar: role === 'goalkeeper' ? (rng.chance(0.75) ? 'crew' : rng.pick(KIT_COLLARS)) : rng.pick(KIT_COLLARS),
    primary: main,
    secondary: built.secondary,
    trim,
    // Ink is chosen for the shirt it is printed on, and always the better of
    // the two: the sponsor's name has to clear 4.5:1 on a mid-orange shirt as
    // much as on a navy one.
    ink: inkForColours(inkSource),
    shorts,
    shortsTrim: trim,
    socks: rng.chance(0.58) ? main : patternSource,
    socksTrim: trim,
  };
}

/**
 * A full set of strips for one season.
 *
 * `option` is the design the manager is looking at: it changes the pattern, the
 * away and goalkeeper colours and the trim, never the club's own colours, and
 * never the maker or the sponsor. Three options, three shirts in the club's
 * colours, and he picks the one he wants to run out in.
 */
export function kitPlanFor(request: KitRequest, option = 0): KitSet {
  const { seed, clubId, seasonLabel, colours } = request;
  const maker = makerFor(stream(seed, 'kit', 'maker', seasonLabel, clubId));
  // The design stream is per option, so option 2 next season is not option 2's
  // numbers again: every season, every design, its own roll of the dice.
  const rng = stream(seed, 'kit', 'design', seasonLabel, clubId, option);

  const primary = colours.primary;
  const secondary = patternColour(primary, colours.secondary);
  const home = designFor(rng, 'home', primary, secondary, primary);

  // The away shirt has to be tellable from the home one, and from the club's
  // second colour, which is what the stripes on it are.
  const awayPool = PRINTABLE_CHANGE_COLOURS.filter(
    (colour) => colourDistance(colour, primary) >= MIN_KIT_DISTANCE && colourDistance(colour, secondary) >= 60,
  );
  const awayMain = partnerFor(rng, primary, awayPool.length > 0 ? awayPool : PRINTABLE_CHANGE_COLOURS);
  const awaySecondary = partnerFor(rng, awayMain, [secondary, ...PRINTABLE_CHANGE_COLOURS]);
  const away = designFor(rng, 'away', awayMain, awaySecondary, awayMain);

  const keeperMain = partnerFor(
    rng,
    awayMain,
    PRINTABLE_KEEPER_COLOURS.filter((colour) => colourDistance(colour, primary) >= MIN_KIT_DISTANCE),
  );
  const keeperSecondary = partnerFor(rng, keeperMain, PRINTABLE_CHANGE_COLOURS);
  const goalkeeper = designFor(rng, 'goalkeeper', keeperMain, keeperSecondary, keeperMain);

  return {
    season: seasonLabel,
    option,
    maker,
    sponsor: request.sponsor,
    home,
    away,
    goalkeeper,
  };
}

/** Every design the club is offered this season, in the order they are shown. */
export function kitOptionsForRequest(request: KitRequest, count = KIT_OPTION_COUNT): KitSet[] {
  return Array.from({ length: count }, (_, option) => kitPlanFor(request, option));
}

/** The club's colours, as a plain pair for the planner. */
export function coloursOf(club: Club): { primary: string; secondary: string } {
  return { primary: club.identity.colours.primary, secondary: club.identity.colours.secondary };
}

/* The club's kit, from the game state -------------------------------------
 *
 * Everything above is pure decisions; everything below reads a career. The kit
 * is never stored — it is rebuilt from the seed, the season and the one number
 * the manager set — so a save always shows the strip the club would have had.
 */

/**
 * The club's shirt sponsor: the business it has actually agreed a deal with,
 * falling back to the business behind its name for a club that has none. The
 * agreement is the authority; `sponsorIds` is only the name source.
 */
export function sponsorFor(game: GameState, club: Club): KitSponsor | null {
  const deal = (game.sponsorship?.deals ?? [])
    .filter((candidate) => candidate.clubId === club.id && candidate.status === 'active')
    .at(-1);
  const businessId = deal?.sponsorId ?? club.sponsorIds[0];
  return sponsorFromBusiness(businessId ? game.world.businesses[businessId] : null);
}

/** Everything the planner needs, taken from the career the club is in. */
export function kitRequest(game: GameState, club: Club): KitRequest {
  return {
    seed: game.seed,
    clubId: club.id,
    seasonLabel: game.season.label,
    colours: coloursOf(club),
    sponsor: sponsorFor(game, club),
  };
}

/** The design the club is wearing, clamped to the designs that were offered. */
/**
 * Has this club settled its shirts for the season it is in?
 *
 * True when a kit has been picked with this season label on it. A save written
 * before the label existed has no `kitSeason`, so a club that *did* pick a kit
 * is treated as settled — otherwise every old career would be handed a kit
 * prompt it had already answered.
 */
export function kitChosenForSeason(club: Club, seasonLabel: string): boolean {
  if (club.kitSeason === seasonLabel) return true;
  return club.kitSeason === undefined && club.kitChoice !== undefined;
}

/**
 * Is the club still in the summer, before the first league game of the season?
 *
 * Not `game.phase`: a career opens with `phase` already set to `'season'` and
 * the six weeks before the opener are pre-season in every sense that matters
 * here. The league calendar is the honest boundary — friendlies can only be
 * arranged for dates before its first entry.
 */
export function inPreSeason(game: GameState): boolean {
  const opener = game.season.calendar[0]?.date;
  return opener !== undefined && game.date < opener;
}

/**
 * Whether the kit is worth offering: a new season's shirts have arrived and the
 * manager has not yet said which to run out in.
 */
export function kitDecisionOutstanding(game: GameState, clubId: ClubId): boolean {
  if (!inPreSeason(game)) return false;
  const club = game.clubs[clubId];
  if (!club) return false;
  return !kitChosenForSeason(club, game.season.label);
}

export function chosenKitOption(club: Club): number {
  const option = Math.floor(club.kitChoice ?? 0);
  return Number.isFinite(option) && option >= 0 && option < KIT_OPTION_COUNT ? option : 0;
}

/** The strips the club runs out in this season. */
export function clubKit(game: GameState, clubId: ClubId): KitSet | null {
  const club = game.clubs[clubId];
  if (!club) return null;
  return kitPlanFor(kitRequest(game, club), chosenKitOption(club));
}

/** Every design the club was offered this season, in the order they are shown. */
export function clubKitOptions(game: GameState, clubId: ClubId): KitSet[] {
  const club = game.clubs[clubId];
  if (!club) return [];
  return kitOptionsForRequest(kitRequest(game, club));
}

/**
 * The strips the two sides actually turn out in, for one match.
 *
 * Home plays in its home shirt. The visiting side plays in its away shirt —
 * which is the whole point of a club having an away strip, and the reason a
 * side running out in white should not be painted in its club colour
 * everywhere. The colour bar across the top of the match screen, the swing bars
 * under the pitch and the tint on the commentary all answer one question, "whose
 * moment is this?", and the honest answer is the shirt on the player's back
 * rather than the colour in the club's identity.
 *
 * When the two first colours are too close to tell apart the visitors change
 * into the spare set from the boot of a car, which is what the local game
 * actually does — and which {@link INCIDENT_POOL} already jokes about.
 */
export function matchKits(
  game: GameState,
  homeClubId: ClubId,
  awayClubId: ClubId,
): { home: KitDesign | null; away: KitDesign | null } {
  const homeKit = clubKit(game, homeClubId);
  const awayKit = clubKit(game, awayClubId);
  const home = homeKit?.home ?? null;
  let away = awayKit?.away ?? null;
  if (home && away && colourDistance(home.primary, away.primary) < MIN_KIT_DISTANCE) {
    away = awayKit?.goalkeeper ?? away;
  }
  return { home, away };
}

/**
 * The first colour of the strip each side is wearing, for tinting the screen.
 *
 * Falls back to the club's own colours when a club has no kit generated — the
 * bar should never simply vanish because a save predates kits.
 */
export function matchKitColours(
  game: GameState,
  homeClubId: ClubId,
  awayClubId: ClubId,
): { home: string; away: string } {
  const kits = matchKits(game, homeClubId, awayClubId);
  return {
    home: kits.home?.primary ?? game.clubs[homeClubId]?.identity.colours.primary ?? '#888888',
    away: kits.away?.primary ?? game.clubs[awayClubId]?.identity.colours.primary ?? '#888888',
  };
}
