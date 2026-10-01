import type { GameState } from '@/domain/game';
import type { ClubId, PersonId } from '@/domain/ids';
import { isPlayer, type Player } from '@/domain/person';
import { attitudeOf } from '@/domain/relationship';
import { getRelationship, relationshipViewsFor } from '../relationships';
import { squadNeeds } from './needs';
import { Rng } from '../rng';

/**
 * Whether the player would actually come.
 *
 * A discovered player is not a resource waiting to be claimed: he has a job, a
 * car, a family, mates at his current club, and his own view of whether he
 * fancies yours. Every factor below is a real thing about him, and the manager
 * only ever sees the answer as a sentence.
 */

/** Distance between two towns, on the same scale the fixtures use. */
export function travelKm(state: GameState, fromTownId: string | null, toTownId: string | null): number {
  if (!fromTownId || !toTownId) return 0;
  const from = state.world.towns[fromTownId];
  const to = state.world.towns[toTownId];
  if (!from || !to) return 0;
  if (from.id === to.id) return 0;
  return Math.round(Math.hypot(from.x - to.x, from.y - to.y) * 0.45 * 10) / 10;
}

export interface InterestReason {
  /** "It is a fair trek from Yarnwick every Sunday." */
  text: string;
  weight: number;
  /** How the player would put it himself, if he turns you down. */
  quote: string;
}

export interface InterestAssessment {
  score: number;
  reasons: InterestReason[];
}

function appearancesThisSeason(player: Player): number {
  const season = player.record.seasons[player.record.seasons.length - 1];
  if (season) return season.appearances + season.substituteAppearances;
  return player.record.appearances + player.record.substituteAppearances;
}

/**
 * 0-100. Around 55 is a coin toss, and the manager never sees the number — he
 * sees the hints the player gives him.
 */
export function candidateInterest(state: GameState, personId: PersonId, clubId: ClubId): InterestAssessment {
  const person = state.people[personId];
  const club = state.clubs[clubId];
  const reasons: InterestReason[] = [];
  if (!isPlayer(person) || !club) return { score: 0, reasons };

  const player = person;
  let score = 46;
  const add = (weight: number, text: string, quote: string): void => {
    score += weight;
    reasons.push({ weight, text, quote });
  };

  const playerTown = player.townId ? state.world.towns[player.townId] : undefined;
  const distance = travelKm(state, club.townId, player.townId);

  if (distance <= 2 && playerTown) {
    add(10, `Lives in ${playerTown.name}.`, 'It is on my doorstep, so no problem.');
  } else if (distance >= 4) {
    const penalty = Math.min(26, Math.round((distance - 3) * 1.5));
    add(-penalty, `It is ${distance} km from ${playerTown?.name ?? 'where he lives'}.`, 'It is a long way to go every Sunday.');
  }

  if (!player.clubId) {
    add(18, 'Not registered with anyone at the moment.', 'I am not playing anywhere, so I would give it a go.');
  } else {
    add(-12, `Currently registered with ${state.clubs[player.clubId]?.identity.shortName ?? 'another club'}.`, 'I am sorted where I am.');
    const currentManagerId = state.clubs[player.clubId]?.managerId ?? null;
    const withManager = currentManagerId ? getRelationship(state, player.id, currentManagerId) : undefined;
    if (withManager) {
      const own = attitudeOf(withManager, player.id)!;
      if (own.tension >= 50 || own.trust <= 34) {
        add(18, 'Not getting on with his manager there.', 'Things have gone a bit sour there, to be honest.');
      } else if (own.trust >= 62 && own.loyalty >= 58) {
        add(-16, 'Happy with his current manager.', 'I am happy where I am, sorry.');
      }
    }
    const gamesPlayed = state.clubs[player.clubId]?.history.seasons[0]?.played ?? 0;
    const appearances = appearancesThisSeason(player);
    if (gamesPlayed >= 4 && appearances <= Math.max(1, gamesPlayed * 0.25)) {
      add(14, `Only ${appearances} appearances there this season.`, 'I am not getting a game there.');
    }
  }

  // Mates already at the club are the single biggest reason Sunday players move.
  let friendPull = 0;
  let enemies = 0;
  for (const view of relationshipViewsFor(state, player.id)) {
    const other = state.people[view.otherId];
    if (!isPlayer(other) || other.clubId !== clubId) continue;
    if (view.attitude.friendship >= 62 && view.attitude.tension < 45) {
      friendPull += 1;
      if (friendPull <= 2) {
        add(7, `Knows ${other.firstName} ${other.surname} here.`, `My mate ${other.firstName} plays for you.`);
      }
    }
    if (view.attitude.tension >= 55) {
      enemies += 1;
      if (enemies <= 2) {
        add(-13, `Has fallen out with ${other.firstName} ${other.surname}.`, `Me and ${other.firstName} do not get on.`);
      }
    }
  }

  const userManagerId = club.managerId;
  if (userManagerId) {
    const withManager = getRelationship(state, player.id, userManagerId);
    if (withManager) {
      const own = attitudeOf(withManager, player.id)!;
      if (own.trust >= 60) add(10, 'Thinks well of you already.', 'I know you from before — I would play for you.');
      else if (own.tension >= 50) add(-14, 'Not keen on you.', 'Not sure we would get on, you and me.');
    }
  }

  if (club.reputation >= 52) add(6, 'The club has a decent name locally.', 'You are a decent side, everyone knows that.');
  else if (player.attributes.behavioural.ambition >= 14) {
    add(-8, 'Reckons he should be playing at a better club.', 'I fancy a go somewhere higher up.');
  }

  const needs = squadNeeds(state, clubId);
  const group = player.positionGroup;
  if (needs.thinGroups.includes(group)) {
    add(9, `You are short at ${group.toLowerCase() === 'gk' ? 'goalkeeper' : group.toLowerCase()}.`, 'You need players in my position, so I would get a game.');
  } else {
    const need = needs.positions.find((entry) => entry.group === group);
    if (need && need.verdict === 'strong') {
      add(-7, `You are well covered at ${need.label.toLowerCase()}.`, 'You have loads there already — would I even play?');
    }
  }

  if (player.age <= 21) add(5, 'Young and wants games.', 'I just want to play every week.');
  if (player.age >= 35) add(4, 'Wants to keep playing while he can.', 'I am not done yet, I just want a game.');
  if (player.attributes.behavioural.loyalty >= 15 && player.clubId) {
    add(-6, 'Loyal sort — not a mover.', 'I could not leave the lads in it.');
  }
  if (player.attributes.behavioural.ambition >= 15) add(3, 'Ambitious.', 'I want to win things.');

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons: reasons.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)),
  };
}

export interface InvitationResult {
  accepted: boolean;
  /** The plausible sentence he gives, either way. */
  response: string;
  score: number;
}

/** Ask him whether he fancies it. He decides, not the manager. */
export function resolveInvitation(
  state: GameState,
  personId: PersonId,
  clubId: ClubId,
  rng: Rng,
  options: { threshold?: number } = {},
): InvitationResult {
  const assessment = candidateInterest(state, personId, clubId);
  const roll = rng.gaussian(0, 7.5);
  const accepted = assessment.score + roll >= (options.threshold ?? 55);

  if (accepted) {
    const positives = assessment.reasons.filter((reason) => reason.weight > 0);
    const best = positives[0] ?? { text: 'Fancies it.', quote: 'Sound, count me in.' };
    return {
      accepted: true,
      response: `${best.quote} ${assessment.score >= 72 ? 'That was an easy one.' : 'He needed a bit of talking round.'}`,
      score: assessment.score,
    };
  }

  const negative = assessment.reasons.find((reason) => reason.weight < 0);
  return {
    accepted: false,
    response: negative ? negative.quote : 'Not for him at the moment.',
    score: assessment.score,
  };
}

/** A short hint for the candidate list: never the number, just the gist. */
export function interestHint(state: GameState, personId: PersonId, clubId: ClubId): string {
  const { score, reasons } = candidateInterest(state, personId, clubId);
  if (score >= 72) return 'Sounds keen.';
  if (score >= 58) return 'Worth asking.';
  if (score >= 46) return 'Might take some persuading.';
  const blocker = reasons.find((reason) => reason.weight < 0);
  return blocker ? `Sounds unlikely — ${blocker.text.toLowerCase()}` : 'Sounds unlikely.';
}
