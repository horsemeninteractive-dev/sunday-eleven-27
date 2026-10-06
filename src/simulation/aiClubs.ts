import type { Club } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, PlayerId } from '@/domain/ids';
import { isPlayer, type Player } from '@/domain/person';
import { abilityMean } from './queries';
import { clubStandardQuality } from './generation/worldGenerator';
import { linkNewTeammate } from './generation/relationshipGenerator';
import { removePersonFromCommunication } from './communication/store';
import { relationshipStore, removePersonRelationships } from './relationships';
import { leaveClubStaff } from './staff';
import { Rng, stream } from './rng';

/**
 * What the other thirty-five clubs do in the summer.
 *
 * Until this existed the world's only football decisions were the manager's. Every
 * other club aged its players, took a youth intake and topped itself up from thin
 * air — nobody ever signed anybody, nobody ever let anybody go, and the
 * unattached pool in the town grew by a dozen men a season and never emptied. The
 * soak found it: the pool more than doubled over ten seasons while every squad
 * stayed exactly as full as it was.
 *
 * Two decisions, and only two, because two is what it takes for players to move
 * between clubs:
 *
 *  - **Released men join the pool.** A thirty-four-year-old let go by his club
 *    does not vanish from the world; he is a man in a town who needs a game. He
 *    becomes unattached, with the reason on his record, and is available to be
 *    signed the following week.
 *
 *  - **Clubs fill their gaps from the pool.** A club short of bodies after
 *    retirements signs the best man available rather than inventing one, so the
 *    world's total of footballers is conserved and the pool is a market with
 *    both sides in it.
 *
 * Both are seeded per club per season, so the same career signs the same men.
 * There is no scouting, no negotiation and no agent: a club sees the pool, picks
 * from it, and the player joins. That is the whole of it, and it is enough.
 */

export const AI_CLUBS = {
  /**
   * The age at which a released player joins the pool rather than leaving the
   * world. Older than this and he has stopped playing; the world is not a
   * database of every man in the county who once played for a club.
   */
  maxReleasedAge: 36,
  /** How many men a club will sign from the pool in one summer. */
  maxSigningsPerSeason: 4,
  /**
   * A signing has to be at least this good, as a share of the club's standing. A
   * village side does not sign a man markedly worse than what it already fields.
   */
  signingFloor: 0.92,
} as const;

/** The age at which a player stops being a candidate for anybody's squad. */
const RETIREMENT_AGE = 41;

/** Ability, as one number, for a player. */
function rating(player: Player): number {
  return abilityMean(player);
}

/**
 * Put a released player into the unattached pool.
 *
 * Returns false if he is too old to still be in the game, in which case he
 * leaves the world the way the old code did.
 */
export function releaseToPool(player: Player): boolean {
  if (player.age > AI_CLUBS.maxReleasedAge) return false;
  player.clubId = null;
  player.homeGroundId = null;
  player.notes = [`Released by his club at ${player.age}.`];
  return true;
}

/**
 * One club's summer: sign whoever it needs from the pool.
 *
 * Only gaps are filled, against a target the caller sets. A club that retires
 * two men and releases one signs three, back to the size it was; a club that
 * loses nobody to retirement and releases nobody signs nobody, which is what
 * stops every squad in the pyramid growing in step.
 */
export function clubSignsFromPool(
  state: GameState,
  club: Club,
  rng: Rng,
  seasonStart: ISODate,
  targetSquadSize: number,
  options: { cap?: number; replaces?: readonly number[] } = {},
): PlayerId[] {
  const signed: PlayerId[] = [];
  const cap = options.cap ?? Number.POSITIVE_INFINITY;
  const target = Math.max(0, Math.min(targetSquadSize, cap));
  const gap = target - club.squadIds.length;
  if (gap <= 0) return signed;

  const signedIds = new Set<string>();
  const wanted = Math.min(gap, AI_CLUBS.maxSigningsPerSeason);

  // The level the club plays at, read from its standing rather than from the
  // squad it happens to have. A target taken from the current squad rises with
  // the squad, and thirty-six clubs each signing men a little better than what
  // they already field ratchet the whole county upward — the soak watched the
  // bottom division gain six percent over fifteen seasons that way. Taken from
  // the reputation, the club has a level to be rebuilt to instead of a level
  // that climbs with every signing.
  const standard = clubStandardQuality(club.reputation);

  // What the club is looking for. With no scouting, a club replaces like with
  // like: the men it has just let go set the level it shops at, and it never
  // signs a man better than the club itself is. A side below its standard can
  // climb back to it; a side above it cannot keep climbing, because there is
  // nothing above the club's own standard to sign. That ceiling is also what
  // stops the best players in the county draining into the top division every
  // summer, without flattening the ladder the way a flat cap would.
  const replaces = options.replaces ?? [];
  const benchmark = replaces.length > 0
    ? replaces.reduce((sum, value) => sum + value, 0) / replaces.length
    : standard;
  const floor = Math.min(standard, benchmark) * AI_CLUBS.signingFloor;
  const ceiling = standard;

  for (let attempt = 0; attempt < wanted; attempt += 1) {
    // Men past the age they retire at are not candidates however good they
    // still are. They retired; they are in the pool because a club folded or
    // because they gave up, not because they are available, and signing one puts
    // a forty-three-year-old back on a roster for the season.
    const pool = Object.values(state.people).filter(
      (person): person is Player =>
        isPlayer(person) &&
        person.clubId === null &&
        !signedIds.has(person.id) &&
        person.age < RETIREMENT_AGE,
    );
    const available = pool.filter((person) => {
      const value = rating(person);
      return value >= floor && value <= ceiling;
    });
    // Nobody in the county good enough for this club's standard. It takes the
    // best of a bad lot rather than nobody: a club short of bodies signs a man
    // who is not quite good enough, which is what actually happens, and it is
    // what keeps the pool a market rather than a waiting room.
    const field = available.length > 0 ? available : attempt === 0 ? pool.filter((person) => rating(person) <= ceiling) : [];
    if (field.length === 0) break;

    // Best man available, with a nudge towards somebody local: a club signs the
    // lad from the next village over before the one from across the county.
    const choice = field
      .map((player) => ({
        player,
        score:
          rating(player) +
          (player.townId === club.townId ? 1.5 : 0) +
          rng.float(0, 1.2) -
          Math.min(2, (player.age - 30) * 0.2),
      }))
      .sort((a, b) => b.score - a.score || a.player.id.localeCompare(b.player.id))[0];
    if (!choice) break;

    signPlayer(state, club, choice.player, seasonStart);
    signedIds.add(choice.player.id);
    signed.push(choice.player.id);
  }
  return signed;
}

/**
 * Put a player on a club's books.
 *
 * Shared by the AI and the manager's own recruitment so a signing made either
 * way leaves the same records behind: the squad list, the relationships with the
 * men he will be playing with, and the candidate file cleared out.
 */
export function signPlayer(state: GameState, club: Club, player: Player, seasonStart: ISODate): void {
  const previousClubId = player.clubId;
  player.clubId = club.id;
  player.homeGroundId = club.groundId;
  player.registered = true;
  player.roles = [{ clubId: club.id, role: 'player', since: seasonStart }];
  if (!player.notes.some((note) => note.startsWith('Released'))) {
    player.notes = [`Signed for ${club.identity.name}.`];
  } else {
    player.notes = [...player.notes.filter((note) => !note.startsWith('Signed')), `Signed for ${club.identity.name}.`];
  }
  // One season's registration, not a career: the archive and the appearance
  // tables read this, and a club that signs a man in June has not played him yet.
  // The season list itself is left alone — it is the man's own history and does
  // not belong to the club he happens to be on now.
  player.record = {
    ...player.record,
    appearances: 0,
    substituteAppearances: 0,
    goals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
  };
  if (previousClubId) {
    const previous = state.clubs[previousClubId];
    if (previous) previous.squadIds = previous.squadIds.filter((id) => id !== player.id);
  }
  club.squadIds.push(player.id);
  const teammates = club.squadIds.filter((id) => id !== player.id);
  linkNewTeammate(relationshipStore(state), state.seed, club, player.id, teammates, seasonStart);
  if (state.recruitment?.candidates?.[player.id]) delete state.recruitment.candidates[player.id];
}

/**
 * Every AI club's summer, in a fixed order.
 *
 * The order is by club id rather than by the state's key order so the same save
 * always produces the same summer — and it is the *same* order for every club,
 * because a signing made by one club must be visible to the next: a man cannot
 * be signed twice, and which club got him depends on who went first.
 */
export function runAiClubSummer(state: GameState, seasonId: string, seasonStart: ISODate, legalMinimum: number): void {
  const clubIds = Object.values(state.clubs)
    .filter((club) => club.active && club.id !== state.userClubId)
    .map((club) => club.id)
    .sort((a, b) => a.localeCompare(b));

  for (const clubId of clubIds) {
    const club = state.clubs[clubId];
    if (!club || !club.active) continue;
    const rng = stream(state.seed, 'ai-signings', seasonId, clubId);
    // A club that fell below the legal minimum through no transfer business of
    // its own — folded and reformed, say — still has to sign somebody.
    clubSignsFromPool(state, club, rng, seasonStart, legalMinimum);
  }
}

/** Take a man off a club's books and put him in the pool, or out of the world. */
export function releaseFromClub(state: GameState, club: Club, player: Player): void {
  // He may have been doubling up on the committee — a player-coach, a player
  // secretary. The post goes with him, so a club never keeps a staff slot
  // naming a man who is no longer at the club or in the world.
  leaveClubStaff(state, club.id, player.id);
  club.squadIds = club.squadIds.filter((id) => id !== player.id);
  if (club.history.records.recordAppearanceHolderId === player.id) {
    club.history.records.recordAppearanceHolderId = null;
  }
  if (club.history.records.recordGoalscorerId === player.id) club.history.records.recordGoalscorerId = null;
  if (!releaseToPool(player)) {
    delete state.people[player.id];
    removePersonRelationships(state, player.id);
    removePersonFromCommunication(state, player.id);
  }
  for (const candidateId of Object.keys(state.recruitment?.candidates ?? {})) {
    if (candidateId === player.id && state.recruitment) delete state.recruitment.candidates[candidateId];
  }
}

/** The club a signed player now belongs to, by id. Useful in tests. */
export function clubOf(state: GameState, playerId: PlayerId): ClubId | null {
  const person = state.people[playerId];
  return person && isPlayer(person) ? person.clubId : null;
}