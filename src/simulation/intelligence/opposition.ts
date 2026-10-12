import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, MatchId, PlayerId } from '@/domain/ids';
import type { Match } from '@/domain/match';
import { isOfficial, isPlayer } from '@/domain/person';
import {
  POSITIONS,
  POSITION_GROUP_LABEL,
  type FormationId,
  type PositionCode,
  type PositionGroup,
} from '@/domain/positions';
import type { KnowledgeConfidence } from '@/domain/recruitment';
import { clubStyle } from '../ai/style';
import { formatShortDate } from '../calendar';
import { clubMatches } from '../queries';
import { staffCompetence, staffIsAvailable, staffMembers } from '../staff';

/**
 * What the manager knows about the side he is about to play.
 *
 * The game already had a football identity for every club (`ai/style.ts`) and
 * the tactics screen printed one derived line from it. That line is a fact about
 * the *club* — it is what their manager sends them out with — and it was the
 * whole of the opposition intelligence. Nothing read what they had actually been
 * doing: the shape they lined up in, who scored, where the goals came from, or
 * whether any of it had changed since the last time anybody looked.
 *
 * This is that reading, built the way the recruitment system already works
 * elsewhere: **every line carries where it came from and how much of it there
 * is.** The things that need no eyes — results, scorelines, dates — are known
 * exactly, because a Sunday manager reads the results. Everything else has to be
 * *watched*: the manager sees the matches he was at, and the rest of the county
 * is the work of whoever the club has out watching. A club with a good scout in
 * post has a fuller and truer picture than one with nobody, which is the point
 * of having him.
 *
 * Three things it never does:
 *
 *  - it does not invent a tactical description the record does not support;
 *  - it does not treat one afternoon as proof of a permanent identity;
 *  - it does not hide the fact that it has nothing, which is a real answer and
 *    an honest one before a manager has seen a side at all.
 *
 * Nothing here decides any football. It is a reader: it turns the match records
 * the simulation wrote into the sentences a manager would say, so the tactics
 * screen and the matchday card print one reading rather than each guessing at
 * one.
 */

/** How many of a club's matches the manager can hold any detail about. */
const DETAIL_WINDOW = 8;
/** How many of them count as *recent* for the reads that lean on recency. */
const RECENT_WINDOW = 4;
/** Fewest observed matches a shape or a player is ever called on. */
const MINIMUM_FOR_A_READ = 2;

/** One match of theirs, as the report reads it. */
export interface OppositionMatch {
  matchId: MatchId;
  date: ISODate;
  matchday: number;
  competition: string;
  /** From the opponent's point of view. */
  venue: 'H' | 'A' | 'N';
  opponentName: string;
  /** Their score first: "3–1". */
  score: string;
  outcome: 'W' | 'D' | 'L';
  /** The shape they were recorded in. */
  formation: FormationId;
  goalsFor: number;
  goalsAgainst: number;
  possession: number | null;
  shots: number | null;
  corners: number;
  fouls: number;
  yellowCards: number;
  sentOff: number;
  /** Who scored, with the position he was playing, and whether it was a penalty. */
  scorers: Array<{ playerId: PlayerId | null; position: PositionCode | null; penalties: number }>;
  /** The minutes their goals against arrived in. */
  concededMinutes: number[];
  startingIds: PlayerId[];
  /** Whether the manager was there, or somebody at the club was. */
  source: 'you' | 'the club';
}

export interface OppositionKeyPlayer {
  playerId: PlayerId;
  name: string;
  position: PositionCode;
  note: string;
  matches: number;
  goals: number;
}

export interface DossierRead {
  id: 'output' | 'defence' | 'shape' | 'change' | 'personnel';
  title: string;
  /** Sentences, facts first. */
  lines: string[];
  /** How many of their matches the read rests on. */
  matches: number;
  /** Where it came from, in the manager's own words. */
  source: string;
  confidence: KnowledgeConfidence;
  /** Whether the line is a reading of the record or a reasonable inference from it. */
  kind: 'fact' | 'interpretation';
}

export interface OppositionDossier {
  clubId: ClubId;
  clubName: string;
  clubShortName: string;
  /** The plan they will set out with, from the club's own instructions. */
  plan: { label: string; formation: FormationId; lines: string[] };
  /** Their recent results, which are public and exact. */
  results: OppositionMatch[];
  /**
   * The matches there is detail behind — the manager's own, plus the ones
   * somebody at the club watched. Everything that reads *how* they play reads
   * from here and nowhere else.
   */
  observed: OppositionMatch[];
  /** The exact form line, for the top of a screen. */
  form: string;
  reads: DossierRead[];
  keyPlayers: OppositionKeyPlayer[];
  /** Two to four lines for a screen, the most actionable first. */
  summary: string[];
  evidence: {
    /** Matches of theirs with any detail behind them. */
    matches: number;
    watchedByYou: number;
    watchedByStaff: number;
    staffName: string | null;
    earliest: ISODate | null;
    latest: ISODate | null;
  };
  /** True when there is nothing to go on beyond the results. */
  empty: boolean;
}

function outcomeFor(goalsFor: number, goalsAgainst: number): 'W' | 'D' | 'L' {
  if (goalsFor > goalsAgainst) return 'W';
  if (goalsFor === goalsAgainst) return 'D';
  return 'L';
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function firstNameOf(state: GameState, playerId: PlayerId | null): string {
  const person = playerId ? state.people[playerId] : undefined;
  if (!isPlayer(person)) return 'an unnamed player';
  return `${person.firstName.charAt(0)}. ${person.surname}`;
}

function sideOf(match: Match, clubId: ClubId): 'home' | 'away' | null {
  if (match.homeClubId === clubId) return 'home';
  if (match.awayClubId === clubId) return 'away';
  return null;
}

/**
 * Who has actually seen this side play.
 *
 * The manager's own fixtures against them are first-hand, so they are always in.
 * Everything past that depends on somebody going out to watch: the club's scout
 * has the contacts and the reach for it, and the assistant does it when there is
 * no scout. Nobody on the staff means nobody watches anybody, and a side you
 * have not played is a name and a league position.
 */
interface Watching {
  ids: Set<MatchId>;
  byYou: Set<MatchId>;
  staffName: string | null;
  staffReach: number;
}

function watchingFor(state: GameState, matches: Match[]): Watching {
  const viewer = state.clubs[state.userClubId];
  const byYou = new Set<MatchId>();
  if (viewer) {
    for (const match of matches) {
      if (match.homeClubId === viewer.id || match.awayClubId === viewer.id) byYou.add(match.id);
    }
  }

  let staffName: string | null = null;
  let staffReach = 0;
  if (viewer) {
    for (const member of staffMembers(viewer)) {
      if (member.role !== 'scout' && member.role !== 'assistant') continue;
      const person = state.people[member.personId];
      if (!person || !isOfficial(person) || !staffIsAvailable(person)) continue;
      const competence = staffCompetence(person, member.role);
      // A good scout gets out to more of the county than a poor one, and a club
      // with neither gets no detail beyond the games it played itself.
      const reach = 1 + Math.round((competence / 20) * 4);
      if (reach > staffReach) {
        staffReach = reach;
        staffName = `${person.firstName} ${person.surname}`;
      }
    }
  }

  const ids = new Set<MatchId>(byYou);
  // `slice(-0)` is the whole array, so a club with nobody watching gets nothing
  // rather than everything — which is the difference between a report and a
  // printout of every result in the county.
  if (staffReach > 0) {
    const unwatched = matches
      .filter((match) => !ids.has(match.id))
      .sort((a, b) =>
        a.matchday === b.matchday ? String(a.date).localeCompare(String(b.date)) : a.matchday - b.matchday,
      )
      .slice(-staffReach);
    for (const match of unwatched) ids.add(match.id);
  }

  return { ids, byYou, staffName, staffReach };
}

/** One match, read from the record. */
function readMatch(
  state: GameState,
  match: Match,
  clubId: ClubId,
  watching: Watching,
): OppositionMatch | null {
  const side = sideOf(match, clubId);
  if (!side || !match.played || !match.result) return null;
  const lineup = match.lineups[side];
  const goalsFor = side === 'home' ? match.result.homeGoals : match.result.awayGoals;
  const goalsAgainst = side === 'home' ? match.result.awayGoals : match.result.homeGoals;

  const positionOf = (playerId: PlayerId | null): PositionCode | null => {
    if (!playerId) return null;
    const performance = match.performances[playerId];
    if (performance) return performance.positionPlayed;
    return lineup.starting.find((slot) => slot.playerId === playerId)?.position ?? null;
  };

  const scorers: OppositionMatch['scorers'] = [];
  const concededMinutes: number[] = [];
  let corners = 0;
  for (const event of match.events) {
    if (event.type === 'corner') {
      if (event.clubId === clubId) corners += 1;
      continue;
    }
    const goal = event.type === 'goal' || event.type === 'penalty-scored' || event.type === 'own-goal';
    if (!goal) continue;
    // An own goal is filed against the side that *benefits* it, so the scoring
    // club is the one the event names either way — see `domain/match.ts`.
    if (event.clubId === clubId) {
      scorers.push({
        playerId: event.playerId,
        position: positionOf(event.playerId),
        penalties: event.type === 'penalty-scored' ? 1 : 0,
      });
    } else {
      concededMinutes.push(event.minute);
    }
  }

  let fouls = 0;
  let yellowCards = 0;
  let sentOff = 0;
  for (const performance of Object.values(match.performances)) {
    if (performance.clubId !== clubId) continue;
    fouls += performance.fouls;
    yellowCards += performance.yellowCards;
    if (performance.sentOff) sentOff += 1;
  }

  return {
    matchId: match.id,
    date: match.date,
    matchday: match.matchday,
    competition: match.competitionName,
    venue: match.neutralVenue ? 'N' : side === 'home' ? 'H' : 'A',
    opponentName: (side === 'home' ? state.clubs[match.awayClubId] : state.clubs[match.homeClubId])?.identity
      .shortName ?? 'the opposition',
    score: `${goalsFor}–${goalsAgainst}`,
    outcome: outcomeFor(goalsFor, goalsAgainst),
    formation: lineup.tactics?.formation ?? (lineup.formation as FormationId),
    goalsFor,
    goalsAgainst,
    possession: side === 'home' ? match.result.homePossession : match.result.awayPossession,
    shots: side === 'home' ? match.result.homeShots : match.result.awayShots,
    corners,
    fouls,
    yellowCards,
    sentOff,
    scorers,
    concededMinutes,
    startingIds: lineup.starting.map((slot) => slot.playerId),
    source: watching.byYou.has(match.id) ? 'you' : 'the club',
  };
}

function share(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  return `${Math.round((part / whole) * 100)}%`;
}

function groupLabel(group: PositionGroup): string {
  return POSITION_GROUP_LABEL[group].toLowerCase();
}

/**
 * Their results, which are public: a manager reads them whether anybody watched
 * or not. Exact, and deliberately not dressed up as an estimate.
 */
export function oppositionPublicForm(
  state: GameState,
  clubId: ClubId,
  limit = 5,
): { played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; perMatch: number } {
  const matches = clubMatches(state, clubId).filter((match) => match.played && match.result);
  const recent = matches
    .slice()
    .sort((a, b) => b.matchday - a.matchday)
    .slice(0, limit);
  let won = 0;
  let drawn = 0;
  let lost = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  for (const match of recent) {
    const side = sideOf(match, clubId);
    if (!side || !match.result) continue;
    const scored = side === 'home' ? match.result.homeGoals : match.result.awayGoals;
    const conceded = side === 'home' ? match.result.awayGoals : match.result.homeGoals;
    goalsFor += scored;
    goalsAgainst += conceded;
    const outcome = outcomeFor(scored, conceded);
    if (outcome === 'W') won += 1;
    else if (outcome === 'D') drawn += 1;
    else lost += 1;
  }
  return {
    played: recent.length,
    won,
    drawn,
    lost,
    goalsFor,
    goalsAgainst,
    perMatch: recent.length > 0 ? goalsFor / recent.length : 0,
  };
}

/** The dossier for one opponent. */
export function oppositionDossier(
  state: GameState,
  opponentId: ClubId,
  options: { window?: number } = {},
): OppositionDossier {
  const club = state.clubs[opponentId];
  const window = options.window ?? DETAIL_WINDOW;
  const base: OppositionDossier = {
    clubId: opponentId,
    clubName: club?.identity.name ?? 'The opposition',
    clubShortName: club?.identity.shortName ?? 'them',
    plan: { label: 'Ordinary Sunday football', formation: '4-4-2', lines: [] },
    results: [],
    observed: [],
    form: 'No results yet this season.',
    reads: [],
    keyPlayers: [],
    summary: [],
    evidence: { matches: 0, watchedByYou: 0, watchedByStaff: 0, staffName: null, earliest: null, latest: null },
    empty: true,
  };
  if (!club) return base;

  // The plan is the club's own instructions, which is a fact about them rather
  // than a reading of anything: it is what their manager sends them out with.
  const style = clubStyle(club);
  const plan = {
    label: style.label,
    formation: style.formation,
    lines: [
      `They set out ${style.formation}, ${style.label.toLowerCase()}.`,
      `${
        style.tempo === 'high' ? 'Quick' : style.tempo === 'slow' ? 'Slow' : 'Ordinary'
      } tempo, ${
        style.passingStyle === 'direct'
          ? 'getting it forward early'
          : style.passingStyle === 'short'
            ? 'keeping it on the deck'
            : 'mixing it up'
      }.`,
    ],
  };
  const withPlan: OppositionDossier = { ...base, plan };

  const played = clubMatches(state, opponentId).filter((match) => match.played && match.result);
  if (played.length === 0) {
    return { ...withPlan, summary: ['Nothing to go on yet — they have not played a match this season.'] };
  }

  const watching = watchingFor(state, played);
  const read = played
    .map((match) => readMatch(state, match, opponentId, watching))
    .filter((entry): entry is OppositionMatch => entry !== null)
    .sort((a, b) => b.matchday - a.matchday);

  // The public half: every result, newest first. These need no eyes on them.
  const results = read.slice(0, 6);
  // The watched half, which is what any read of *how* they play rests on.
  const observed = read.filter((entry) => watching.ids.has(entry.matchId)).slice(0, window);
  const recent = observed.slice(0, RECENT_WINDOW);
  const matchesById = new Map(played.map((match) => [match.id, match] as const));

  const reads: DossierRead[] = [];
  const summary: string[] = [];
  const record = {
    won: results.filter((entry) => entry.outcome === 'W').length,
    drawn: results.filter((entry) => entry.outcome === 'D').length,
    lost: results.filter((entry) => entry.outcome === 'L').length,
  };
  const form = `${record.won}W ${record.drawn}D ${record.lost}L in their last ${results.length} — ${results
    .slice(0, 4)
    .map((entry) => `${entry.venue} ${entry.score}`)
    .join(', ')}`;

  // --- What they do with the ball -------------------------------------------
  if (observed.length >= MINIMUM_FOR_A_READ) {
    const goalsFor = mean(observed.map((entry) => entry.goalsFor));
    const scorers = observed.flatMap((entry) => entry.scorers);
    const byGroup = new Map<PositionGroup, number>();
    for (const scorer of scorers) {
      if (!scorer.position) continue;
      const group = POSITIONS[scorer.position].group;
      byGroup.set(group, (byGroup.get(group) ?? 0) + 1);
    }
    const top = [...byGroup.entries()].sort((a, b) => b[1] - a[1])[0];
    const penalties = scorers.reduce((sum, scorer) => sum + scorer.penalties, 0);
    const corners = mean(observed.map((entry) => entry.corners));
    const possession = mean(observed.map((entry) => entry.possession ?? 0));
    const lines = [`${goalsFor.toFixed(1)} goals a game in the ${observed.length} you have a record of.`];
    if (top && top[1] >= 2) lines.push(`${share(top[1], scorers.length)} of their goals come from ${groupLabel(top[0])}.`);
    if (corners >= 5) lines.push(`They get through ${corners.toFixed(1)} corners a game, so they put it in the box.`);
    if (possession >= 54) lines.push(`They see a lot of the ball — ${possession.toFixed(0)}% on average.`);
    else if (possession > 0 && possession <= 45) lines.push(`They do not mind being without it — ${possession.toFixed(0)}% of the ball.`);
    if (penalties > 0) lines.push(`${penalties} of their goals have come from the spot.`);
    reads.push({
      id: 'output',
      title: 'What they do with it',
      lines,
      matches: observed.length,
      source: sourceLine(observed, watching),
      confidence: confidenceFor(observed),
      kind: 'fact',
    });
    summary.push(
      `${goalsFor.toFixed(1)} goals a game${top && top[1] >= 2 ? `, mostly from ${groupLabel(top[0])}` : ''}.`,
    );
  }

  // --- What they do without it ---------------------------------------------
  if (observed.length >= MINIMUM_FOR_A_READ) {
    const goalsAgainst = mean(observed.map((entry) => entry.goalsAgainst));
    const cleanSheets = observed.filter((entry) => entry.goalsAgainst === 0).length;
    const conceded = observed.flatMap((entry) => entry.concededMinutes);
    const late = conceded.filter((minute) => minute >= 75).length;
    const fouls = mean(observed.map((entry) => entry.fouls));
    const yellows = mean(observed.map((entry) => entry.yellowCards));
    const lines = [`They concede ${goalsAgainst.toFixed(1)} a game.`];
    if (cleanSheets >= 2) lines.push(`${cleanSheets} clean sheets in ${observed.length}.`);
    if (conceded.length >= 3) lines.push(`${share(late, conceded.length)} of the goals against them have come after 75 minutes.`);
    if (fouls >= 12) lines.push(`They give away ${fouls.toFixed(0)} fouls a game — a side that stops you rather than contains you.`);
    if (yellows >= 2.5) lines.push(`${yellows.toFixed(1)} bookings a game on average.`);
    reads.push({
      id: 'defence',
      title: 'How they cope without it',
      lines,
      matches: observed.length,
      source: sourceLine(observed, watching),
      confidence: confidenceFor(observed),
      kind: conceded.length >= 3 ? 'interpretation' : 'fact',
    });
    if (goalsAgainst >= 2.5) summary.push(`They concede ${goalsAgainst.toFixed(1)} a game, so there is something to go at.`);
  }

  // --- The shape, and whether it has changed --------------------------------
  if (observed.length >= 1) {
    const formations = new Map<FormationId, number>();
    for (const entry of observed) formations.set(entry.formation, (formations.get(entry.formation) ?? 0) + 1);
    const sorted = [...formations.entries()].sort((a, b) => b[1] - a[1]);
    const main = sorted[0]![0];
    const lines = [`Usually ${main} — ${sorted[0]![1]} of the ${observed.length} you have a record of.`];
    if (sorted[1]) lines.push(`They have also lined up ${sorted[1][0]} ${sorted[1][1]} time${sorted[1][1] === 1 ? '' : 's'}.`);
    reads.push({
      id: 'shape',
      title: 'The shape they line up in',
      lines,
      matches: observed.length,
      source: sourceLine(observed, watching),
      confidence:
        observed.length >= MINIMUM_FOR_A_READ
          ? sorted.length === 1 && confidenceFor(observed) === 'known'
            ? 'known'
            : confidenceFor(observed)
          : 'hunch',
      kind: 'fact',
    });
    if (observed.length >= MINIMUM_FOR_A_READ && sorted.length === 1) {
      summary.push(`${main} and no messing: the same shape in all ${observed.length} of their matches.`);
    }
  }

  // --- Has anything changed since anybody last looked -----------------------
  if (observed.length >= 3) {
    // What counts as "now" is half the evidence, so the comparison works at
    // three matches and at eight alike: the recent half against the earlier half.
    const changeWindow = Math.max(1, Math.min(3, Math.floor(observed.length / 2)));
    const nowShape = dominantFormation(observed.slice(0, changeWindow));
    const earlierShape = dominantFormation(observed.slice(changeWindow));
    const stillThere = new Set(club.squadIds);
    const watchedMen = new Set(observed.flatMap((entry) => entry.startingIds));
    const movedOn = [...watchedMen].filter((id) => !stillThere.has(id) && state.people[id]).length;
    const lines: string[] = [];
    if (nowShape && earlierShape && nowShape !== earlierShape) {
      lines.push(
        `They have changed shape: ${nowShape} in their last ${changeWindow === 1 ? 'match' : `${changeWindow}`} after ${earlierShape} earlier on.`,
      );
    }
    const recentWins = recent.filter((entry) => entry.outcome === 'W').length;
    if (recentWins >= 3) lines.push(`${recentWins} wins in their last ${recent.length}.`);
    if (lines.length === 0) lines.push('Nothing has changed: the same shape and the same sort of results all season.');
    reads.push({
      id: 'change',
      title: 'Anything new',
      lines,
      matches: observed.length,
      source: 'Their recent matches, against what the club saw earlier in the season.',
      confidence: 'reported',
      kind: 'interpretation',
    });
    if (movedOn > 0) {
      reads.push({
        id: 'personnel',
        title: 'Faces that have moved on',
        lines: [
          movedOn === 1
            ? 'One of the eleven you have a record of is no longer at the club.'
            : `${movedOn} of the eleven you have a record of are no longer at the club — the side may not be the one that was reported on.`,
        ],
        matches: observed.length,
        source: 'Their squad today, against the teams they picked.',
        confidence: 'known',
        kind: 'fact',
      });
    }
  }

  // --- Who to watch out for -------------------------------------------------
  const keyPlayers: OppositionKeyPlayer[] = [];
  if (observed.length >= MINIMUM_FOR_A_READ) {
    interface Tally {
      goals: number;
      matches: number;
      ratings: number[];
      minutes: number;
      position: PositionCode | null;
    }
    const byPlayer = new Map<PlayerId, Tally>();
    const tally = (playerId: PlayerId, position: PositionCode | null): Tally => {
      const current = byPlayer.get(playerId) ?? { goals: 0, matches: 0, ratings: [], minutes: 0, position };
      byPlayer.set(playerId, current);
      return current;
    };

    for (const entry of observed) {
      for (const scorer of entry.scorers) {
        if (!scorer.playerId) continue;
        const current = tally(scorer.playerId, scorer.position);
        current.goals += 1;
        if (scorer.position) current.position = scorer.position;
      }
      const match = matchesById.get(entry.matchId);
      if (!match) continue;
      for (const performance of Object.values(match.performances)) {
        if (performance.clubId !== opponentId) continue;
        const current = tally(performance.playerId, performance.positionPlayed);
        current.matches += 1;
        current.ratings.push(performance.rating);
        current.minutes += performance.minutesPlayed;
        current.position = performance.positionPlayed;
      }
    }

    const ranked = [...byPlayer.entries()]
      .map(([playerId, entry]) => ({ playerId, ...entry, meanRating: mean(entry.ratings) }))
      .sort((a, b) => b.goals - a.goals || b.meanRating - a.meanRating || a.playerId.localeCompare(b.playerId));

    const scorer = ranked.find((entry) => entry.goals > 0);
    if (scorer) {
      keyPlayers.push({
        playerId: scorer.playerId,
        name: firstNameOf(state, scorer.playerId),
        position: scorer.position ?? 'CM',
        note: `${scorer.goals} goal${scorer.goals === 1 ? '' : 's'} in the ${scorer.matches} match${scorer.matches === 1 ? '' : 'es'} you have a record of.`,
        matches: scorer.matches,
        goals: scorer.goals,
      });
      summary.push(`One to watch: ${firstNameOf(state, scorer.playerId)} (${scorer.goals} in ${scorer.matches}).`);
    }
    const keeper = ranked.find((entry) => entry.position === 'GK' && entry.matches >= MINIMUM_FOR_A_READ);
    if (keeper) {
      keyPlayers.push({
        playerId: keeper.playerId,
        name: firstNameOf(state, keeper.playerId),
        position: 'GK',
        note: `Their keeper, averaging ${keeper.meanRating.toFixed(1)} over ${keeper.matches} matches.`,
        matches: keeper.matches,
        goals: keeper.goals,
      });
    }
  }

  // A thin report says so. It is the one thing a manager needs to know before he
  // reads anything else in it: how much of this there actually is.
  if (observed.length === 0) {
    summary.push(
      watching.byYou.size === 0 && watching.staffReach === 0
        ? `You have not played ${club.identity.shortName} this season and nobody at the club has watched them. The results are all there is.`
        : `${club.identity.shortName} are new to you, and nothing anybody watched has come back yet — the results are all there is.`,
    );
  } else if (observed.length < MINIMUM_FOR_A_READ) {
    summary.push(
      `One afternoon so far: the shape, and not much else — a single match is not a pattern.`,
    );
  }

  return {
    clubId: opponentId,
    clubName: club.identity.name,
    clubShortName: club.identity.shortName,
    plan,
    results,
    observed,
    form,
    reads,
    keyPlayers: keyPlayers.slice(0, 2),
    summary,
    evidence: {
      matches: observed.length,
      watchedByYou: observed.filter((entry) => entry.source === 'you').length,
      watchedByStaff: observed.filter((entry) => entry.source === 'the club').length,
      staffName: watching.staffName,
      earliest: observed.length > 0 ? observed[observed.length - 1]!.date : null,
      latest: observed.length > 0 ? observed[0]!.date : null,
    },
    empty: observed.length === 0,
  };
}

/** The shape a run of matches is mostly played in. */
function dominantFormation(entries: OppositionMatch[]): FormationId | null {
  if (entries.length === 0) return null;
  const tally = new Map<FormationId, number>();
  for (const entry of entries) tally.set(entry.formation, (tally.get(entry.formation) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
}

/** Where the detail in a read came from, in words the manager would use. */
function sourceLine(observed: OppositionMatch[], watching: Watching): string {
  const mine = observed.filter((entry) => entry.source === 'you').length;
  const theirs = observed.length - mine;
  const parts: string[] = [];
  if (mine > 0) parts.push(mine === 1 ? 'the match you were at' : `${mine} matches you were at`);
  if (theirs > 0) {
    parts.push(
      watching.staffName
        ? `${theirs} ${watching.staffName} watched`
        : `${theirs} somebody at the club watched`,
    );
  }
  return `From ${parts.join(' and ')}.`;
}

/**
 * How solid a read is.
 *
 * First-hand and more than one afternoon is as good as it gets; a single match
 * is a hunch however well it was watched, because one Sunday is not a pattern.
 */
function confidenceFor(observed: OppositionMatch[]): KnowledgeConfidence {
  if (observed.length < MINIMUM_FOR_A_READ) return 'hunch';
  return observed.some((entry) => entry.source === 'you') ? 'known' : 'reported';
}

/** The date range a report covers, for a screen to print beside it. */
export function dossierFreshness(dossier: OppositionDossier): string {
  if (!dossier.evidence.latest) return 'Nothing seen yet this season';
  if (dossier.evidence.earliest === dossier.evidence.latest) {
    return `One match, ${formatShortDate(dossier.evidence.latest)}`;
  }
  return `${formatShortDate(dossier.evidence.earliest!)} to ${formatShortDate(dossier.evidence.latest)}`;
}
