import type { Club } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, PersonId } from '@/domain/ids';
import type { GameEvent, GameEventType, NewsItem } from '@/domain/news';
import {
  FILED_KEY_LIMIT,
  MAX_LIVE_RUMOURS,
  PUBLICATION_KIND_LABEL,
  RUMOUR_STATUS_LABEL,
  RUMOUR_SUBJECT_LABEL,
  emptyPressState,
  reliabilityOf,
  type Journalist,
  type PressFocus,
  type PressState,
  type Publication,
  type PublicationKind,
  type Rumour,
  type RumourStatus,
  type RumourSubject,
} from '@/domain/press';
import { isPlayer } from '@/domain/person';
import { addDays } from './calendar';
import { personFirstName, personSurname } from './generation/names';
import { nextId } from './ids';
import { createEvent } from './news';
import { divisionOf, standingsFor } from './pyramid';
import { variant } from './prose';
import { stream, type Rng } from './rng';
import { adjustSupporterConfidence, supportConfidenceOf } from './support';

/**
 * The local press, at work.
 *
 * The news service already turns structured events into readable stories; what
 * this module adds is *who wrote them and why*. Three jobs, in order:
 *
 *   1. **Who is there.** A county gets a handful of papers, a station, a website
 *      and a fanzine, each in a town, each with one reporter whose patch is
 *      decided by geography — the clubs nearest his paper. Generated from the
 *      world seed, kept for the career, redrawn only when the season turns.
 *   2. **What gets covered.** Every published story is offered to the reporter
 *      whose patch it falls on, and he decides by importance, by whether it is
 *      his sort of thing, and by whether the manager has given him a reason to
 *      keep watching. A story nobody files is still printed — the manager knows
 *      things without reading the paper — but it has no masthead on it.
 *   3. **What is only claimed.** A rumour is a claim built from a fact the
 *      simulation already keeps, filed with a source and an evidence level, and
 *      settled later by comparing the world against what it said at the time.
 *      The claim follows the world; the world never follows the claim.
 *
 * Nothing here reads a hidden attribute, and nothing here writes a fact the
 * simulation does not already hold. A reporter's knowledge is the news feed's
 * knowledge: the same events, with a person's name on the top of them.
 */

/**
 * One of several ways of writing the same sentence, with the facts filled in.
 *
 * The same contract as the news writer's own `say` — a pool, a key that is the
 * identity of the fact, and a throw if a placeholder has no fact behind it —
 * and a separate one on purpose: the press writes in its own voice, with its own
 * hedges, and its copy must not be rewritable by whoever last edited the club's.
 */
function say(pool: readonly string[], key: string, facts: Record<string, string | number>): string {
  return variant(pool, key).replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = facts[name];
    if (value === undefined) throw new Error(`press prose: no fact named "${name}"`);
    return String(value);
  });
}

/* ---------------------------------------------------------------------------
 * 1. Who is there
 * ------------------------------------------------------------------------ */

const PAPER_STRAPLINES: Record<PublicationKind, readonly string[]> = {
  gazette: ['Every result, every league, every Sunday.', 'The county’s football, printed on a Thursday.'],
  herald: ['The paper this county has read for a hundred years.', 'Local news, local football, local people.'],
  fanzine: ['Written from the touchline, in pencil.', 'By the people who stand behind the goal.'],
  radio: ['Sunday afternoon, 2pm, all the scores.', 'Local football, on the wireless.'],
  site: ['Results in by nine on a Sunday night.', 'The county’s football, as it happens.'],
};

const PAPER_SUFFIXES: Record<PublicationKind, readonly string[]> = {
  gazette: ['Gazette', 'Advertiser', 'Free Press'],
  herald: ['Herald', 'Observer', 'Chronicle'],
  fanzine: ['Fanzine'],
  radio: ['Community Radio', 'Local Radio'],
  site: ['Sunday Football', 'Football', 'The Weekend'],
};

/** Focuses are handed out in a fixed order, so a county always has a spread. */
const FOCUS_ORDER: readonly PressFocus[] = ['results', 'money', 'people', 'community', 'results'];

/**
 * The papers of a new county.
 *
 * One per chosen town, up to five — a county of thirty-six clubs is covered by
 * about that many, and generating one per club would be a fiction nobody asked
 * for. Kinds are rolled except for the first two, which are the local paper and
 * the weekly that every county has.
 */
export function generatePress(state: GameState): PressState {
  const press = emptyPressState();
  const towns = Object.values(state.world.towns);
  if (towns.length === 0) return press;

  const rng = stream(state.seed, 'press', state.world.countyName || 'county');
  const clubs = Object.values(state.clubs).filter((club) => club.active);
  const wanted = Math.max(3, Math.min(5, Math.round(clubs.length / 8)));
  const preferred = towns.filter((town) => town.kind !== 'hamlet');
  const pool = rng.shuffle(preferred.length >= wanted ? preferred : towns);

  pool.slice(0, Math.min(wanted, pool.length)).forEach((town, index) => {
    const kind: PublicationKind =
      index === 0 ? 'gazette' : index === 1 ? 'herald' : rng.pick(['fanzine', 'radio', 'site'] as PublicationKind[]);
    const local = clubs
      .filter((club) => club.townId === town.id)
      .sort((a, b) => b.reputation - a.reputation)[0];
    const publicationId = `press_${index + 1}`;
    press.publications.push({
      id: publicationId,
      name: publicationName(rng, kind, town.name, local?.identity.nickname ?? ''),
      kind,
      townId: town.id,
      founded: pressFoundedYear(rng, kind),
      strapline: rng.pick(PAPER_STRAPLINES[kind]),
    });
    press.journalists.push({
      id: `press_reporter_${index + 1}`,
      firstName: personFirstName(rng),
      surname: personSurname(rng),
      publicationId,
      townId: town.id,
      focus: FOCUS_ORDER[index % FOCUS_ORDER.length]!,
      beats: [],
      since: state.createdAt,
      regard: 50,
      filings: 0,
      lastFiledOn: null,
    });
  });

  return press;
}

function publicationName(rng: Rng, kind: PublicationKind, town: string, nickname: string): string {
  const suffix = rng.pick(PAPER_SUFFIXES[kind]);
  if (kind === 'fanzine') return `${nickname || town} ${suffix}`;
  return `${town} ${suffix}`;
}

function pressFoundedYear(rng: Rng, kind: PublicationKind): number {
  switch (kind) {
    case 'gazette':
    case 'herald':
      return rng.int(1860, 1975);
    case 'fanzine':
      return rng.int(1985, 2016);
    case 'radio':
      return rng.int(1998, 2018);
    default:
      return rng.int(2012, 2024);
  }
}

/**
 * The press this career has.
 *
 * Safe to call anywhere and on any state: it fills in a press for a world that
 * has none (what the migration does for a save written before the press
 * existed, and what the generator does for a new one), repairs a record with a
 * hole in it, and redraws the patches when the season turns — a club promoted
 * into a division three counties away is no longer the nearest paper's business.
 */
export function ensurePress(state: GameState): PressState {
  if (!state.press || !Array.isArray(state.press.publications) || !Array.isArray(state.press.journalists)) {
    state.press = generatePress(state);
  }
  const press = state.press;
  if (!Array.isArray(press.rumours)) press.rumours = [];
  if (!Array.isArray(press.filed)) press.filed = [];
  if (!Array.isArray(press.statements)) press.statements = [];
  if (press.publications.length === 0 || press.journalists.length === 0) {
    const generated = generatePress(state);
    press.publications = generated.publications;
    press.journalists = generated.journalists;
  }
  if (press.beatsDrawnFor !== state.season.label) drawBeats(state);
  return press;
}

/**
 * Hand every club to the reporter who is nearest to it.
 *
 * A partition rather than a shopping list: each club belongs to exactly one
 * patch, so there is always somebody whose story it is, and no club is covered
 * by everybody. Distances are the same map coordinates the rest of the world
 * uses, so a reporter's patch is a shape on the map rather than a list somebody
 * typed. Ties break on the order the papers were generated, so the partition is
 * the same on every run.
 */
export function drawBeats(state: GameState): void {
  const press = state.press;
  if (!press?.journalists?.length) return;
  const towns = state.world.towns;
  const beats = new Map<PersonId, ClubId[]>();
  for (const journalist of press.journalists) beats.set(journalist.id, []);

  for (const club of Object.values(state.clubs)) {
    if (!club.active) continue;
    const home = towns[club.townId];
    if (!home) continue;
    let best = press.journalists[0]!;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const journalist of press.journalists) {
      const base = towns[journalist.townId];
      if (!base) continue;
      const distance = Math.hypot(base.x - home.x, base.y - home.y);
      if (distance < bestDistance) {
        best = journalist;
        bestDistance = distance;
      }
    }
    beats.get(best.id)!.push(club.id);
  }

  for (const journalist of press.journalists) {
    journalist.beats = (beats.get(journalist.id) ?? []).sort();
  }
  press.beatsDrawnFor = state.season.label;
}

/** The reporter whose patch this club is on — or the nearest one, as a fallback. */
export function journalistForClub(state: GameState, clubId: ClubId): Journalist | null {
  const press = state.press;
  if (!press?.journalists?.length) return null;
  const onBeat = press.journalists.find((journalist) => journalist.beats?.includes(clubId));
  if (onBeat) return onBeat;
  const town = state.clubs[clubId] ? state.world.towns[state.clubs[clubId]!.townId] : undefined;
  if (!town) return press.journalists[0]!;
  return (
    [...press.journalists].sort((a, b) => {
      const at = state.world.towns[a.townId];
      const bt = state.world.towns[b.townId];
      const ad = at ? Math.hypot(at.x - town.x, at.y - town.y) : Number.POSITIVE_INFINITY;
      const bd = bt ? Math.hypot(bt.x - town.x, bt.y - town.y) : Number.POSITIVE_INFINITY;
      return ad - bd;
    })[0] ?? null
  );
}

export function publicationOf(state: GameState, journalist: Journalist | null): Publication | null {
  if (!journalist) return null;
  return state.press?.publications?.find((publication) => publication.id === journalist.publicationId) ?? null;
}

/* ---------------------------------------------------------------------------
 * 2. What gets covered
 * ------------------------------------------------------------------------ */

/**
 * Which reporter bothers with which kind of story.
 *
 * Deliberately partial, and the absence is the rule: a type that is not listed
 * is one no reporter files, so it reaches the manager as the club's own
 * knowledge rather than as a story with a name on it. Routine things — a
 * training night, a referee appointed — are not news, and pretending otherwise
 * is how a feed becomes a log.
 */
const PRESS_INTEREST: Partial<Record<GameEventType, readonly PressFocus[]>> = {
  'match-result': ['results'],
  'notable-result': ['results'],
  'league-movement': ['results'],
  'cup-result': ['results'],
  'cup-draw': ['results'],
  'season-milestone': ['results'],
  forfeit: ['results'],
  'goal-milestone': ['results'],
  'appearance-milestone': ['people'],
  injury: ['people'],
  'player-unavailable': ['people'],
  'availability-crisis': ['people'],
  'player-signed': ['people'],
  'player-released': ['people'],
  recruitment: ['people'],
  'player-approach': ['people'],
  development: ['people'],
  'dressing-room': ['people'],
  'finances-warning': ['money'],
  'finances-positive': ['money'],
  'club-event': ['money', 'community'],
  social: ['community'],
  'club-news': ['community'],
  world: ['community', 'results'],
  postponement: ['community'],
};

export interface PressCoverage {
  journalist: Journalist;
  publication: Publication;
  confidence: RumourStatus;
}

/**
 * Whether this event gets a name on it, and whose.
 *
 * The rules are about attention rather than knowledge, which is the whole
 * difference between a local paper and an oracle:
 *
 *   - **something that matters** — a manager leaving, a cup upset, a club
 *     folding — is filed by whoever is closest to it, because a county talks
 *     about it wherever it happened;
 *   - **something ordinary** is filed by the reporter whose patch it is, if it
 *     is his sort of thing at all;
 *   - **a claim** is always filed by the reporter who heard it, and carries his
 *     name whether or not the club is on his patch, because it is his source;
 *   - **a manager who has snubbed a reporter** gets watched a little harder:
 *     a reporter whose regard has been run down will file about that club's
 *     small stories as well. He is still not told anything he could not see.
 */
export function pressCoverageFor(state: GameState, event: GameEvent): PressCoverage | null {
  const press = state.press;
  if (!press?.journalists?.length) return null;

  if (event.type === 'press-rumour' || event.type === 'press-verdict') {
    const id = typeof event.data.journalistId === 'string' ? event.data.journalistId : '';
    const journalist = press.journalists.find((candidate) => candidate.id === id);
    return journalist ? coverageOf(state, journalist, event) : null;
  }

  const clubId = event.clubIds[0];
  const journalist = clubId ? journalistForClub(state, clubId) : press.journalists[0]!;
  if (!journalist) return null;
  if (!coveredBy(state, journalist, event)) return null;
  return coverageOf(state, journalist, event);
}

function coveredBy(state: GameState, journalist: Journalist, event: GameEvent): boolean {
  if (event.importance === 3) return true;
  const onBeat = event.clubIds.length === 0 || event.clubIds.some((id) => journalist.beats?.includes(id) ?? false);
  if (event.importance === 2) return onBeat;
  if (!onBeat) return false;
  const interests = PRESS_INTEREST[event.type];
  if (!interests) return false;
  if (interests.includes(journalist.focus)) return true;
  return event.clubIds.includes(state.userClubId) && journalist.regard < 35;
}

function coverageOf(state: GameState, journalist: Journalist, event: GameEvent): PressCoverage | null {
  const publication = publicationOf(state, journalist);
  if (!publication) return null;
  return { journalist, publication, confidence: confidenceIn(event) };
}

function confidenceIn(event: GameEvent): RumourStatus {
  const claimed = event.data.confidence;
  if (claimed === 'unverified' || claimed === 'confirmed' || claimed === 'disproved' || claimed === 'stale') return claimed;
  return 'confirmed';
}

/**
 * Put the masthead on a story.
 *
 * The one place a story acquires an outlet, a name and a standing, and it is
 * called from the publishing pipeline rather than from the writer of any
 * individual story — so every route into the feed is attributed by the same
 * rule, and no system writes its own byline.
 */
export function attributeStory(state: GameState, event: GameEvent, item: NewsItem): void {
  const coverage = pressCoverageFor(state, event);
  if (!coverage) return;
  item.outlet = coverage.publication.name;
  item.byline = `${coverage.journalist.firstName} ${coverage.journalist.surname}`;
  item.journalistId = coverage.journalist.id;
  item.confidence = coverage.confidence;
  coverage.journalist.filings += 1;
  coverage.journalist.lastFiledOn = event.date;
}

/**
 * A story's identity, for telling one from another.
 *
 * Built from the event's *facts* rather than from its id, because the id is
 * handed out fresh every time an event is created: a day processed twice makes
 * two events out of the same afternoon, and the paper must not print it twice.
 * The facts are the same both times, so this key is too. Sorted, so an event
 * rebuilt with its clubs in a different order still matches.
 */
export function storyKey(event: GameEvent): string {
  const data = Object.keys(event.data)
    .sort()
    .map((key) => `${key}=${event.data[key]}`)
    .join('&');
  return [
    event.type,
    event.date,
    event.matchId ?? '',
    [...event.clubIds].sort().join(','),
    [...event.personIds].sort().join(','),
    data,
  ].join('|');
}

/** Whether this story has already been printed. */
export function isFiled(state: GameState, key: string): boolean {
  return state.press?.filed?.includes(key) ?? false;
}

/** Remember a story as printed, forgetting the oldest once the ring is full. */
export function markFiled(state: GameState, key: string): void {
  const press = state.press;
  if (!press) return;
  if (!Array.isArray(press.filed)) press.filed = [];
  if (press.filed.includes(key)) return;
  press.filed.push(key);
  if (press.filed.length > FILED_KEY_LIMIT) press.filed = press.filed.slice(press.filed.length - FILED_KEY_LIMIT);
}

/* ---------------------------------------------------------------------------
 * 3. What is only claimed
 * ------------------------------------------------------------------------ */

const CLAIM_POOLS: Record<RumourSubject, readonly string[]> = {
  manager: [
    '{club} are understood to be losing patience with {manager}.',
    'There is talk at {club} that {manager} is on borrowed time.',
    'People around {club} say the committee has started asking questions about {manager}.',
    '{manager} is said to be under pressure at {club}.',
  ],
  money: [
    'There is said to be trouble with the books at {club}.',
    'Word is that {club} are struggling to pay their way.',
    '{club} are understood to be behind on what they owe.',
    'They are saying the money has run out at {club}.',
  ],
  availability: [
    '{club} are said to be short for Sunday.',
    'Word reaches us that {club} are struggling for numbers.',
    '{club} are in a state — {count} of them unavailable, by one account.',
    'The whisper is that {club} may not be able to raise a side.',
  ],
  transfer: [
    'Somebody has been asking about {person}.',
    '{person} is said to be interesting clubs further up.',
    'There is talk that {person} will not be at {club} next season.',
    '{club} are understood to be braced for an approach for {person}.',
  ],
};

const CLAIM_HEADLINES: Record<RumourSubject, readonly string[]> = {
  manager: ['Questions at {short}', 'Pressure building at {short}', '{short}: a manager under scrutiny'],
  money: ['Money worries at {short}', 'Trouble with the books at {short}', '{short} counting the pennies'],
  availability: ['{short} short of numbers', 'Numbers worry for {short}', '{short} counting heads'],
  transfer: ['{person} attracting interest', '{person} linked with a move', 'Interest in {person}'],
};

const CLAIM_HEDGES: Record<RumourSubject, readonly string[]> = {
  manager: [
    'Nobody at {short} is saying anything yet, and the committee has not met.',
    'It is the talk in the pubs around {short}, and the club has not denied it.',
    'No official word, and probably none coming.',
  ],
  money: [
    'The club has not commented, and the treasurer is not answering his phone.',
    'Nobody at {short} will talk about the money.',
    'The accounts are not public, which is half the reason people are talking.',
  ],
  availability: [
    'Their team sheet is not out yet, and the manager is not saying.',
    'It is the sort of thing that gets exaggerated on a Saturday night.',
    'A couple of names on that list would be a worry for anybody.',
  ],
  transfer: [
    'No approach has been confirmed, and the player is not saying.',
    'There is nothing official in it, and there usually is not until there is.',
    'The sort of whisper that gets a club’s supporters on the phone to each other.',
  ],
};

const VERDICT_HEADLINES: Record<'confirmed' | 'disproved' | 'stale', readonly string[]> = {
  confirmed: ['{short}: what we heard was right', 'It has happened at {short}', 'Confirmed at {short}'],
  disproved: ['Nothing in the {short} story', 'That {short} talk came to nothing', '{short}: wide of the mark'],
  stale: ['The {short} story has gone quiet', 'Nothing more on {short}'],
};

/**
 * Something worth whispering about, and the fact it is built on.
 *
 * Every candidate names a real, checkable thing: a manager's position, a
 * balance, a headcount, a player's registration. That is not decoration — it is
 * what makes a claim falsifiable, and it is why the press cannot invent a story
 * about something the simulation does not keep.
 */
export interface RumourCandidate {
  key: string;
  subject: RumourSubject;
  clubId: ClubId;
  personId: PersonId | null;
  evidence: number;
  resolvesOn: ISODate;
  basis: { key: string; value: string };
  /** How interesting it is, for the weighted draw. */
  points: number;
}

/** How many of a club's squad are not available this week. */
export function shortfallOf(state: GameState, club: Club): number {
  let missing = 0;
  for (const id of club.squadIds) {
    const person = state.people[id];
    if (!person || person.kind !== 'player') continue;
    if (person.availability?.status !== 'available' || person.injury) missing += 1;
  }
  return missing;
}

/**
 * What a county might be talking about today.
 *
 * Read from the world in front of it: managers in trouble where there is
 * evidence of trouble, clubs in the red, sides short of players, players
 * scoring goals. Each candidate is offered at most once a season per club, so
 * the same four whispers do not circulate for ever.
 */
export function rumourCandidatesFor(state: GameState, date: ISODate): RumourCandidate[] {
  const candidates: RumourCandidate[] = [];
  const seasonKey = state.season.label;

  for (const club of Object.values(state.clubs)) {
    if (!club.active) continue;

    // A manager who might not last the season. His own committee's view is the
    // evidence where the manager is ours; for anybody else it is the table.
    if (club.managerId) {
      const standing = club.id === state.userClubId ? state.governance?.standing : undefined;
      if (club.id === state.userClubId) {
        if (standing === 'pressure' || standing === 'dismissal') {
          candidates.push({
            key: `rumour:manager:${club.id}:${seasonKey}`,
            subject: 'manager',
            clubId: club.id,
            personId: club.managerId,
            evidence: standing === 'dismissal' ? 0.85 : 0.6,
            resolvesOn: addDays(date, 14),
            basis: { key: 'managerId', value: club.managerId },
            points: 4,
          });
        }
      } else {
        const position = leaguePositionOf(state, club.id);
        const form = leagueFormOf(state, club.id);
        const desperate = position > 0 && position >= clubCountInDivision(state, club.id) - 2;
        const sliding = form.length >= 4 && form.slice(0, 4).every((result) => result === 'L');
        if (desperate || sliding) {
          candidates.push({
            key: `rumour:manager:${club.id}:${seasonKey}`,
            subject: 'manager',
            clubId: club.id,
            personId: club.managerId,
            evidence: desperate && sliding ? 0.7 : desperate ? 0.5 : 0.45,
            // The market turns once a season, so that is when the question is
            // answered. An honest rumour is allowed to wait until May.
            resolvesOn: state.season.endDate,
            basis: { key: 'managerId', value: club.managerId },
            points: desperate ? 3 : 2,
          });
        }
      }
    }

    // The books.
    if (club.finances.balance < 0) {
      candidates.push({
        key: `rumour:money:${club.id}:${seasonKey}`,
        subject: 'money',
        clubId: club.id,
        personId: null,
        evidence: club.finances.balance < -250 ? 0.75 : 0.55,
        resolvesOn: addDays(date, 21),
        basis: { key: 'inRed', value: 'yes' },
        points: club.finances.balance < -250 ? 3 : 1,
      });
    }

    // Numbers.
    const short = shortfallOf(state, club);
    if (short >= 3) {
      candidates.push({
        key: `rumour:availability:${club.id}:${seasonKey}`,
        subject: 'availability',
        clubId: club.id,
        personId: null,
        evidence: Math.min(0.85, 0.45 + short * 0.07),
        resolvesOn: addDays(date, 10),
        basis: { key: 'shortfall', value: 'three-or-more' },
        points: 1 + Math.min(2, Math.floor(short / 3)),
      });
    }

    // A centre-forward everybody has noticed, at a club that is not ours. His
    // goals are on the back page every week: this is the least of the secrets
    // in the county, which is why it is believed least.
    if (club.id !== state.userClubId) {
      const name = club.squadIds
        .map((id) => state.people[id])
        .filter((person): person is Extract<typeof person, { kind: 'player' }> => Boolean(person) && person!.kind === 'player')
        .map((player) => ({ player, goals: goalsThisSeason(player, seasonKey) }))
        .filter((entry) => entry.goals >= 5 && (entry.player.age ?? 30) <= 31)
        .sort((a, b) => b.goals - a.goals)[0];
      if (name) {
        candidates.push({
          key: `rumour:transfer:${club.id}:${name.player.id}:${seasonKey}`,
          subject: 'transfer',
          clubId: club.id,
          personId: name.player.id,
          evidence: 0.35,
          resolvesOn: state.season.endDate,
          basis: { key: 'clubId', value: name.player.clubId ?? '' },
          points: 2,
        });
      }
    }
  }

  return candidates;
}

function leaguePositionOf(state: GameState, clubId: ClubId): number {
  const division = divisionOf(state, clubId);
  if (!division) return 0;
  const rows = standingsFor(state, division);
  return rows.findIndex((row) => row.clubId === clubId) + 1;
}

function leagueFormOf(state: GameState, clubId: ClubId): string[] {
  const division = divisionOf(state, clubId);
  if (!division) return [];
  return standingsFor(state, division).find((row) => row.clubId === clubId)?.form ?? [];
}

function clubCountInDivision(state: GameState, clubId: ClubId): number {
  const division = divisionOf(state, clubId);
  if (!division) return 0;
  return standingsFor(state, division).length;
}

function goalsThisSeason(player: { record: { seasons: Array<{ seasonLabel: string; goals: number }> } }, seasonLabel: string): number {
  return player.record.seasons.reduce((total, season) => (season.seasonLabel === seasonLabel ? total + season.goals : total), 0);
}

/**
 * A day's work for the press.
 *
 * Two things happen: what the world has already answered is settled, and — some
 * days — somebody hears something new. There is no third thing. A press that
 * generated a story a day would be a feed rather than a paper, which is why the
 * chance of a new claim is low and the number of live claims is capped.
 */
export function runPressDay(state: GameState, date: ISODate): GameEvent[] {
  const press = ensurePress(state);
  const events: GameEvent[] = [];

  for (const rumour of press.rumours) {
    if (rumour.status !== 'unverified') continue;
    const due = rumour.resolvesOn <= date;
    const verdict = evaluateRumour(state, rumour, due);
    if (verdict.extend && (rumour.extensions ?? 0) < 1) {
      rumour.extensions = (rumour.extensions ?? 0) + 1;
      rumour.resolvesOn = state.season.endDate > date ? state.season.endDate : date;
      continue;
    }
    if (verdict.status === 'pending') continue;
    rumour.status = verdict.status;
    rumour.outcome = verdict.outcome;
    rumour.settledOn = date;
    events.push(verdictStory(state, rumour, verdict));
  }

  events.push(...fileRumour(state, date));
  prunePress(state);
  return events;
}

export interface RumourVerdict {
  status: 'confirmed' | 'disproved' | 'stale' | 'pending';
  outcome: string | null;
  /** The world has not answered yet, and the question is not going away. */
  extend?: boolean;
}

/**
 * What the world says about a claim.
 *
 * The comparison is always against the fact the claim was built on, read at the
 * time and read now: nothing here consults the rumour's own wording, and
 * nothing here makes anything true. A claim that says a club will change
 * manager is confirmed when the club changes manager, and disproved when it
 * does not — never the other way round.
 */
export function evaluateRumour(state: GameState, rumour: Rumour, atDeadline: boolean): RumourVerdict {
  const club = state.clubs[rumour.clubIds[0] ?? ''];
  if (!club) return { status: 'stale', outcome: 'The club is not there any more.' };
  if (!club.active) return { status: 'stale', outcome: `${club.identity.shortName} are not playing any more.` };

  switch (rumour.subject) {
    case 'manager': {
      if ((club.managerId ?? '') !== rumour.basis.value) {
        return { status: 'confirmed', outcome: `${club.identity.shortName} have changed manager since.` };
      }
      if (!atDeadline) return { status: 'pending', outcome: null };
      // The committee has not made its mind up, and the season is over: the
      // question is not going away, so it is put off once rather than answered
      // with a convenient lie.
      if (club.id === state.userClubId && state.governance?.standing === 'pressure') {
        return { status: 'pending', outcome: null, extend: true };
      }
      return { status: 'disproved', outcome: `${club.identity.shortName} have stuck with him.` };
    }
    case 'money': {
      if (!atDeadline) return { status: 'pending', outcome: null };
      return club.finances.balance < 0
        ? { status: 'confirmed', outcome: 'The account is still in the red.' }
        : { status: 'disproved', outcome: 'The books have been balanced since.' };
    }
    case 'availability': {
      if (!atDeadline) return { status: 'pending', outcome: null };
      return shortfallOf(state, club) >= 3
        ? { status: 'confirmed', outcome: 'They are still short of players.' }
        : { status: 'disproved', outcome: 'They have got their numbers back.' };
    }
    case 'transfer': {
      const player = state.people[rumour.personIds[0] ?? ''];
      const moved = !player || !isPlayer(player) || (player.clubId ?? '') !== rumour.basis.value;
      if (moved) {
        return {
          status: 'confirmed',
          outcome: player ? `${player.firstName} ${player.surname} has moved on.` : 'He has moved on.',
        };
      }
      if (!atDeadline) return { status: 'pending', outcome: null };
      return { status: 'disproved', outcome: 'He is still there.' };
    }
  }
}

/**
 * File something new.
 *
 * The dice are rolled before anything is read, so a day that hears nothing
 * costs nothing, and a claim is never filed about a club whose patch has no
 * reporter on it — the press can only talk about what it covers.
 */
function fileRumour(state: GameState, date: ISODate): GameEvent[] {
  const press = ensurePress(state);
  const live = press.rumours.filter((rumour) => rumour.status === 'unverified').length;
  if (live >= MAX_LIVE_RUMOURS) return [];

  const rng = stream(state.seed, 'press-filing', date);
  // Roughly one claim a fortnight across the whole county — which is a couple a
  // season about the manager's own club, and that is the rate a local paper runs
  // at. A story a day would be a feed rather than a paper.
  if (!rng.chance(0.12)) return [];

  const candidates = rumourCandidatesFor(state, date).filter((candidate) => !isFiled(state, candidate.key));
  if (candidates.length === 0) return [];
  const candidate = rng.weighted(candidates.map((entry) => ({ value: entry, weight: entry.points })));

  const club = state.clubs[candidate.clubId];
  const journalist = journalistForClub(state, candidate.clubId);
  const publication = publicationOf(state, journalist);
  if (!club || !journalist || !publication) return [];

  const person = candidate.personId ? state.people[candidate.personId] : undefined;
  const personName = person ? `${person.firstName} ${person.surname}` : 'their centre-forward';
  const facts = {
    club: club.identity.name,
    short: club.identity.shortName,
    person: personName,
    manager: managerNameOf(state, club) ?? 'the manager',
    count: shortfallOf(state, club),
  };
  const claim = say(CLAIM_POOLS[candidate.subject], `${candidate.key}:claim`, facts);
  const rumour: Rumour = {
    id: nextId(state, 'rumour'),
    key: candidate.key,
    date,
    subject: candidate.subject,
    status: 'unverified',
    journalistId: journalist.id,
    clubIds: [club.id],
    personIds: candidate.personId ? [candidate.personId] : [],
    claim,
    evidence: candidate.evidence,
    reliability: reliabilityOf(candidate.evidence, journalist.regard),
    resolvesOn: candidate.resolvesOn,
    basis: candidate.basis,
    outcome: null,
    settledOn: null,
  };
  press.rumours.unshift(rumour);
  markFiled(state, candidate.key);
  journalist.filings += 1;
  journalist.lastFiledOn = date;

  const body = `${claim} ${say(CLAIM_HEDGES[candidate.subject], `${candidate.key}:hedge`, facts)}`;
  return [
    createEvent(state, {
      type: 'press-rumour',
      importance: club.id === state.userClubId ? 2 : 1,
      clubIds: [club.id],
      personIds: rumour.personIds,
      data: {
        headline: say(CLAIM_HEADLINES[candidate.subject], `${candidate.key}:headline`, facts),
        body,
        journalistId: journalist.id,
        rumourId: rumour.id,
        subject: candidate.subject,
        confidence: 'unverified',
      },
    }),
  ];
}

function verdictStory(state: GameState, rumour: Rumour, verdict: RumourVerdict): GameEvent {
  const club = state.clubs[rumour.clubIds[0] ?? ''];
  const status: 'confirmed' | 'disproved' | 'stale' = verdict.status === 'pending' ? 'stale' : verdict.status;
  const journalist = state.press?.journalists?.find((candidate) => candidate.id === rumour.journalistId) ?? null;
  const statement = state.press?.statements?.find((entry) => entry.rumourId === rumour.id);

  // What the manager said comes back to him. A denial of something that then
  // happened is a story in its own right, and a reporter remembers it.
  if (journalist && statement) {
    if (statement.kind === 'declined') journalist.regard = clampRegard(journalist.regard + (status === 'confirmed' ? -8 : 4));
    if (statement.kind === 'acknowledged' && status === 'confirmed') journalist.regard = clampRegard(journalist.regard + 2);
  }

  const facts = { short: club?.identity.shortName ?? 'the club', outcome: verdict.outcome ?? '' };
  const denial =
    statement?.kind === 'declined'
      ? status === 'confirmed'
        ? ' The manager had played the story down, and will be asked about that again.'
        : ' The manager had played it down, and was right to.'
      : '';
  const body = `${rumour.claim} ${verdict.outcome ?? ''}${denial}`.trim();

  return createEvent(state, {
    type: 'press-verdict',
    importance: club?.id === state.userClubId ? 2 : 1,
    clubIds: rumour.clubIds,
    personIds: rumour.personIds,
    data: {
      headline: say(VERDICT_HEADLINES[status], `${rumour.id}:verdict:${status}`, facts),
      body,
      journalistId: rumour.journalistId,
      rumourId: rumour.id,
      subject: rumour.subject,
      confidence: status,
    },
  });
}

function clampRegard(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function managerNameOf(state: GameState, club: Club): string | null {
  const manager = club.managerId ? state.people[club.managerId] : undefined;
  return manager ? `${manager.firstName} ${manager.surname}` : null;
}

/**
 * Answer the paper.
 *
 * The only thing the manager can do about a claim, and the only one worth
 * offering: this is his club, the story is live, and what he says now is
 * remembered — by the reporter, whose view of him moves, and by the crowd, which
 * takes a denial as a denial and an admission as an admission. Nothing about the
 * claim itself changes: playing it down does not make it false.
 */
export function respondToRumour(
  state: GameState,
  rumourId: string,
  kind: 'declined' | 'acknowledged',
): { events: GameEvent[]; message: string } | null {
  const press = state.press;
  if (!press?.rumours) return null;
  const rumour = press.rumours.find((candidate) => candidate.id === rumourId);
  if (!rumour || rumour.status !== 'unverified') return null;
  if (!rumour.clubIds.includes(state.userClubId)) return null;
  if (press.statements.some((statement) => statement.rumourId === rumourId)) return null;

  const journalist = press.journalists.find((candidate) => candidate.id === rumour.journalistId);
  if (journalist) journalist.regard = clampRegard(journalist.regard + (kind === 'declined' ? -6 : 3));
  press.statements.push({ rumourId, journalistId: rumour.journalistId, date: state.date, kind });
  if (press.statements.length > 20) press.statements = press.statements.slice(-20);

  const club = state.clubs[state.userClubId];
  if (club) {
    adjustSupporterConfidence(
      club,
      state.date,
      kind === 'declined' ? 1.5 : -1.5,
      kind === 'declined' ? 'The manager says there is nothing in it.' : 'The manager has admitted there is something in it.',
    );
  }

  const reporter = journalist ? `${journalist.firstName} ${journalist.surname}` : 'the reporter';
  const event = createEvent(state, {
    type: 'club-news',
    importance: 1,
    clubIds: [state.userClubId],
    personIds: rumour.personIds,
    data: {
      headline:
        kind === 'declined'
          ? `${club?.identity.shortName ?? 'The club'} play it down`
          : `Straight answers at ${club?.identity.shortName ?? 'the club'}`,
      body:
        kind === 'declined'
          ? `The manager has dismissed talk that ${lowerFirst(rumour.claim)} ${reporter} has heard it, and will report it either way.`
          : `The manager has not denied the talk that ${lowerFirst(rumour.claim)} ${reporter} will keep asking.`,
    },
  });

  return {
    events: [event],
    message:
      kind === 'declined'
        ? `You have denied it. ${reporter} is not impressed.`
        : `You have given them something. ${reporter} has what he came for.`,
  };
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/**
 * Keep the press record small.
 *
 * Claims are the only thing here that accumulate, and a career runs for years:
 * the live ones are kept, and a handful of settled ones are kept beside them so
 * a verdict has something to refer back to. Everything else is forgotten, which
 * is the honest thing for a claim from three seasons ago.
 */
function prunePress(state: GameState): void {
  const press = state.press;
  if (!press) return;
  if (!Array.isArray(press.rumours)) return;
  const live = press.rumours.filter((rumour) => rumour.status === 'unverified');
  const settled = press.rumours.filter((rumour) => rumour.status !== 'unverified');
  press.rumours = [...live.slice(0, MAX_LIVE_RUMOURS + 2), ...settled.slice(0, 8)];
}

/* ---------------------------------------------------------------------------
 * 4. What the club screens read
 * ------------------------------------------------------------------------ */

export interface ClubPressView {
  publication: Publication;
  journalist: Journalist;
  /** The claims still live about this club. */
  live: Rumour[];
  /** The last few that were settled, newest first. */
  settled: Rumour[];
  /** How much the manager is in this reporter's good books. */
  regard: number;
  /** The crowd's own reading of it, for the same screen. */
  confidence: number;
}

/** Everything the club screen needs about who is writing about this club. */
export function pressForClub(state: GameState, clubId: ClubId): ClubPressView | null {
  const journalist = journalistForClub(state, clubId);
  const publication = publicationOf(state, journalist);
  if (!journalist || !publication) return null;
  const rumours = state.press?.rumours ?? [];
  return {
    publication,
    journalist,
    live: rumours.filter((rumour) => rumour.status === 'unverified' && rumour.clubIds.includes(clubId)),
    settled: rumours.filter((rumour) => rumour.status !== 'unverified' && rumour.clubIds.includes(clubId)).slice(0, 4),
    regard: journalist.regard,
    confidence: supportConfidenceOf(state.clubs[clubId]),
  };
}

/** The claims still live about a club, for anything that wants to ask. */
export function liveRumoursAbout(state: GameState, clubId: ClubId): Rumour[] {
  return (state.press?.rumours ?? []).filter(
    (rumour) => rumour.status === 'unverified' && rumour.clubIds.includes(clubId),
  );
}

/** The labels the interface uses, re-exported so a screen imports one module. */
export { PUBLICATION_KIND_LABEL, RUMOUR_STATUS_LABEL, RUMOUR_SUBJECT_LABEL };
