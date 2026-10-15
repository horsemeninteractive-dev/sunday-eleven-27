import { cupFieldOf, FOUNDING_PYRAMID_ID, type Competition, type Pyramid } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { ClubId, PyramidId, TownId } from '@/domain/ids';
import { draftLadders, draftLadder, type WorldDraft } from '@/simulation/gameSetup';
import { fieldClubs } from '@/simulation/seasonStructure';
import {
  countyOf,
  cupCompetitions,
  divisionNameFor,
  divisionOf,
  divisionsOf,
  foundingCountyId,
  pyramidIdOf,
  pyramidOf,
  pyramidsOf,
  regionNameFor,
} from '@/simulation/pyramid';

/**
 * How the player is shown the county he is playing in.
 *
 * The world has held more than one ladder since the district next door was
 * founded, and everything that reads it by ladder — `pyramidsOf`, `divisionsOf`,
 * `regionNameFor`, `cupFieldOf` — is already in the simulation. What the screens
 * need on top of that is one place that answers the four questions they all ask:
 * which ladders are there, which one is *his*, which divisions make up this one,
 * and whose competition is this cup. Answered here rather than in each screen,
 * because four screens each working out "which ladder is mine" is four chances
 * for one of them to say the wrong one.
 *
 * Nothing here writes: every function is a read of the state it is handed, and
 * the selections a screen keeps (a ladder, a division, a cup) are that screen's
 * own view state — a manager browsing his way around somebody else's league does
 * not change his club, his membership or the world.
 */

/** One ladder, as a picker or a header shows it. */
export interface PyramidOption {
  id: PyramidId;
  /** 'Alderford Sunday League'. */
  name: string;
  /** 'Alderford' — the district whose towns, and so its clubs, it draws on. */
  region: string;
  /** 1 = the county's strongest ladder. */
  level: number;
  /** Its divisions, tier 1 first. */
  divisions: Competition[];
  clubCount: number;
  /** Whether this is the ladder the manager's own club plays in. */
  mine: boolean;
}

/**
 * What a level of football is, said the way the world means it.
 *
 * A ladder's own first division is level 1 whatever its tier number says, so two
 * ladders both have a tier 1 and only one of them is the county's strongest
 * football. A picker that named the two by their tier would call both of them the
 * top division.
 */
const LEVEL_LABELS = ['The county’s own', 'One level below', 'Two levels below', 'Three levels below'];

export function levelLabel(level: number): string {
  if (level <= 1) return LEVEL_LABELS[0]!;
  return LEVEL_LABELS[level - 1] ?? `${level - 1} levels below`;
}

/** Which ladder the manager's own club is in, or null when it is in none. */
export function ownPyramidId(state: GameState): PyramidId | null {
  const division = divisionOf(state, state.userClubId);
  return division ? pyramidIdOf(state, division) : null;
}

/**
 * The ladder a screen opens on: the manager's own, and the county's own when he
 * is in none of them. Never the second ladder by accident — a league table that
 * opens on somebody else's divisions is worse than one that opens on the wrong
 * rung of his own.
 */
export function defaultPyramidId(state: GameState): PyramidId {
  return ownPyramidId(state) ?? state.pyramidIds?.[0] ?? FOUNDING_PYRAMID_ID;
}

/** Every ladder in the county, the founding one first. */
export function pyramidOptions(state: GameState): PyramidOption[] {
  const mine = ownPyramidId(state);
  return pyramidsOf(state).map((pyramid) => pyramidOption(state, pyramid, mine));
}

function pyramidOption(state: GameState, pyramid: Pyramid, mine: PyramidId | null): PyramidOption {
  const divisions = divisionsOf(state, pyramid.id);
  return {
    id: pyramid.id,
    name: pyramid.name,
    region: regionNameFor(state, pyramid.id),
    level: pyramid.level,
    divisions,
    clubCount: divisions.reduce((total, division) => total + division.clubIds.length, 0),
    mine: pyramid.id === mine,
  };
}

/** One ladder of the current world by id, or undefined when it has none. */
export function pyramidOptionOf(state: GameState, pyramidId: PyramidId): PyramidOption | undefined {
  return pyramidOptions(state).find((option) => option.id === pyramidId);
}

/** The territories a competition's entrants are drawn from. */
export type CupScope = 'pyramid' | 'county' | 'invitation';

/** One knockout, with whose competition it is. */
export interface CupOption {
  /** The competition record itself: the draw, the ties and the winner are its own. */
  competition: Competition;
  /** The ladder that runs it, or null when it belongs to no ladder. */
  pyramid: Pyramid | null;
  scope: CupScope;
  /**
   * The competition's own full name, and the only thing a selector prints for it:
   * 'Alderford Sunday League Cup', 'Westbrook Valley Sunday League Plate',
   * 'Alderfordshire County Cup'.
   *
   * There is deliberately no short form. There used to be one — the founding
   * ladder's cups were offered as 'Cup' and 'Plate' — and it does not survive a
   * county with two ladders in it: five knockouts in one list, two of them called
   * 'Cup', is a list a manager has to open one by one to read.
   */
  name: string;
  /** How the competition is filled, in words: who may enter it, or what feeds it. */
  note: string;
  /** Whose competition it is, in words: a ladder's name, or the county's. */
  owner: string;
  /** A Plate is the competition a cup's first-round losers drop into. */
  isPlate: boolean;
  /**
   * This is the manager's own competition: his club is one of its field.
   *
   * Read off the declared *field* rather than the entrants a round has left, and
   * the difference matters most in the one case that would otherwise be wrong: a
   * Plate starts every season with nobody in it, because it is filled by the
   * League Cup's first-round losers, and a manager's club is no less entered in
   * his ladder's Plate for not having lost yet. A cup he has been knocked out of
   * is still his competition, which is the same reading — the screens say whether
   * he is still in it separately, from the ties.
   */
  mine: boolean;
}

/**
 * Every cup in the world, in the order a manager thinks about them.
 *
 * His own ladder's first, then any other ladder's, then the county's — because
 * the county cup is the one that spans the lot and reads as the exception rather
 * than the first of five. Within a ladder the cup comes before the Plate it feeds.
 */
export function cupOptions(state: GameState): CupOption[] {
  const ladderOrder = state.pyramidIds ?? [];
  return cupCompetitions(state)
    .map((competition) => cupOption(state, competition))
    .sort((a, b) => rankOf(a, ladderOrder) - rankOf(b, ladderOrder) || a.name.localeCompare(b.name));
}

/**
 * The cups grouped by the football they belong to, in the order a manager reads
 * them: his own ladder, any other ladder, then the county that runs across both.
 *
 * The grouping is what a selector is built from — one group a ladder, so the
 * ladder and the competition inside it are chosen with one control instead of
 * two rows of tabs — and it is kept here rather than in the screen for the same
 * reason the order is: the county cup belongs to no ladder, and a screen working
 * that out for itself would be a second answer to whose competition it is.
 */
export interface CupGroup {
  /** The ladder whose cups these are, or null for the county's own. */
  pyramid: Pyramid | null;
  /** What the group is called: the ladder's name, or the county's. */
  label: string;
  /** Whether these are the manager's own competitions. */
  mine: boolean;
  cups: CupOption[];
}

export function cupGroups(state: GameState): CupGroup[] {
  const groups: CupGroup[] = [];
  for (const option of cupOptions(state)) {
    const key = option.pyramid?.id ?? null;
    const group = groups.find((candidate) => (candidate.pyramid?.id ?? null) === key);
    if (group) {
      group.cups.push(option);
      group.mine = group.mine || option.mine;
      continue;
    }
    groups.push({
      pyramid: option.pyramid,
      label: option.pyramid ? option.pyramid.name : state.world.countyName,
      mine: option.mine,
      cups: [option],
    });
  }
  return groups;
}

function rankOf(option: CupOption, ladderOrder: readonly PyramidId[]): number {
  // A ladder's own cup: its place in the county, cup before plate. The county's
  // own cup is no ladder's, so it comes after every ladder there is.
  const ladder =
    option.pyramid === null
      ? ladderOrder.length
      : Math.max(0, ladderOrder.indexOf(option.pyramid.id));
  return ladder * 2 + (option.isPlate ? 1 : 0);
}

/**
 * A cup, read through the field it declares.
 *
 * The field is the competition's own statement of who may enter it — the same one
 * the season build draws from and the calendar dates around — so the scope a
 * manager is shown is the scope the competition actually has. What a picker
 * prints is the competition's own name, which the season build composes
 * (`cupNameFor`, and the county's cup named after the county), and what the
 * screen says about it is whose it is (`owner`) and who may be in it (`note`):
 * the three together are enough to tell five knockouts apart without opening
 * any of them.
 */
function cupOption(state: GameState, competition: Competition): CupOption {
  const field = cupFieldOf(competition.cup);
  const pyramid = field.kind === 'pyramid' ? pyramidOf(state, field.pyramidId) : null;
  const isPlate = Boolean(competition.cup?.consolationFor);
  // The cup a Plate is fed from, by the Plate's own record of it: the wording of
  // the note is the plate's business, and asking the competition rather than the
  // screen's own guess is what keeps the two from disagreeing.
  const feeds = competition.cup?.consolationFor
    ? state.competitions[competition.cup.consolationFor]?.name
    : undefined;
  // A county cup's county is the one its field names — read from the field like
  // everything else here, so a world with a second county in it says whose cup
  // each one is rather than printing the career's own county over both.
  const county =
    field.kind === 'county' ? countyOf(state, field.countyId ?? foundingCountyId(state)).name : state.world.countyName;
  // The owner names the competition and the note says who is in it: two facts a
  // header can print side by side without repeating itself.
  const note =
    field.kind === 'county'
      ? `Every club in ${county}, whichever ladder it plays on`
      : field.kind === 'invitation'
        ? 'By invitation'
        : isPlate
          ? `The clubs beaten in the ${feeds ?? 'League Cup'}'s opening rounds drop into it`
          : 'Drawn from every club in this ladder';
  return {
    competition,
    pyramid,
    scope: field.kind,
    name: competition.name,
    note,
    owner: pyramid ? pyramid.name : field.kind === 'county' ? county : 'By invitation',
    isPlate,
    mine: fieldClubs(state, field).includes(state.userClubId),
  };
}

/**
 * A division's name without the ladder's own name in front of it.
 *
 * A ladder's divisions are all named after the region it draws its clubs from, so
 * the whole of a tabstrip inside one ladder would carry the same eleven words
 * before the only one that differs. The name is only shortened when it is the
 * ladder's own — a division named some other way is left exactly as it is.
 */
function shortDivisionName(name: string, region: string): string {
  const prefix = `${region} Sunday League `;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/** The compact name of one division of a ladder: 'Division Three'. */
export function divisionShortName(competition: Competition, option: PyramidOption): string {
  return shortDivisionName(competition.name, option.region);
}

// ---------------------------------------------------------------------------
// A world that has not become a career yet
// ---------------------------------------------------------------------------

export interface DraftLadderOption {
  id: PyramidId;
  name: string;
  region: string;
  level: number;
  /** Its divisions, tier 1 first: the name the season will give it, and the short one a tab wears. */
  divisions: { tier: number; name: string; shortName: string; clubIds: ClubId[] }[];
  clubCount: number;
}

/**
 * The ladders a draft was generated with.
 *
 * The draft's ladders are the world's own description of itself before a career
 * exists to hold it, so the club-selection screen reads them rather than the
 * founding ladder's flat division list — which is the whole difference between
 * offering a manager the county's thirty-six clubs and offering him all
 * seventy-two. A draft with no ladders (one written before they existed) is read
 * as one ladder, which is what it was.
 */
export function draftLadderOptions(draft: WorldDraft): DraftLadderOption[] {
  return draftLadders(draft).map((ladder) => {
    const region = draft.world.regions?.[ladder.regionId]?.name ?? draft.world.regionName;
    const divisions = ladder.divisions.map((clubIds, index) => {
      // The same name the season build will give it, asked of the same function:
      // a manager picking his division should not be shown a name the league
      // table then spells differently.
      const name = divisionNameFor(region, index + 1);
      return {
        tier: index + 1,
        name,
        // And the same short form the league table's own tabstrip uses, so the two
        // screens agree on what a rung of a ladder is called: 'Division Three',
        // never the awkward 'Division 3rd' a bare ordinal gives.
        shortName: shortDivisionName(name, region),
        clubIds,
      };
    });
    return {
      id: ladder.id,
      name: ladder.name,
      region,
      level: ladder.level,
      divisions,
      clubCount: divisions.reduce((total, division) => total + division.clubIds.length, 0),
    };
  });
}

export interface TownChoice {
  id: TownId;
  name: string;
  population: number;
  /** The region it sits in, and so the football it belongs to. */
  region: string;
}

/**
 * The towns a club built in this ladder could call home.
 *
 * A ladder draws its clubs from its own region, so the founding county's towns
 * are offered to a club joining the founding ladder and the district's to a club
 * joining the district's. A world whose towns carry no region of their own — a
 * save written before regions existed — offers every town it has, because
 * refusing all of them would be a screen that cannot be finished.
 */
export function townChoicesFor(draft: WorldDraft, pyramidId: PyramidId): TownChoice[] {
  const ladder = draftLadder(draft, pyramidId);
  const regionName = draft.world.regions?.[ladder.regionId]?.name ?? draft.world.regionName;
  const all = draft.world.townIds.map((id) => draft.world.towns[id]).filter((town) => Boolean(town));
  const inRegion = all.filter((town) => town.regionId === ladder.regionId);
  const towns = inRegion.length > 0 ? inRegion : all;
  return towns
    .slice()
    .sort((a, b) => b.population - a.population)
    .map((town) => ({
      id: town.id,
      name: town.name,
      population: town.population,
      region: draft.world.regions?.[town.regionId]?.name ?? regionName,
    }));
}

// ---------------------------------------------------------------------------
// The picker's own shape
// ---------------------------------------------------------------------------

/** A ladder as the shared picker draws it. */
export interface LadderChoice {
  id: PyramidId;
  /** The region's name: short enough to sit in a tab. */
  label: string;
  /** What it is, in full, for the tooltip. */
  hint: string;
  /** Whether it is the ladder the manager's own club plays in. */
  mine: boolean;
}

/** The choices a picker draws, from either a career's ladders or a draft's. */
export function ladderChoices(
  options: readonly { id: PyramidId; region: string; name: string; level: number; clubCount: number }[],
  mineId: PyramidId | null,
): LadderChoice[] {
  return options.map((option) => ({
    id: option.id,
    label: option.region,
    hint: `${option.name} · ${levelLabel(option.level)} · ${option.clubCount} clubs`,
    mine: option.id === mineId,
  }));
}
