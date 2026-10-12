import type { Club } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { ClubId, ISODate, PlayerId } from '@/domain/ids';
import { isPlayer, type Player } from '@/domain/person';
import { POSITIONS, type PositionCode, type PositionGroup } from '@/domain/positions';
import { abilityMean } from './queries';
import { clubStandardQuality } from './generation/worldGenerator';
import { linkNewTeammate } from './generation/relationshipGenerator';
import { removePersonFromCommunication } from './communication/store';
import { relationshipStore, removePersonRelationships } from './relationships';
import { roleCandidates } from './ai/style';
import { defaultRoleFor, roleProfile } from './match/roles';
import { PLAYABLE_AT, squadAssessment, type SigningPriority, type SquadAssessment } from './recruitment/needs';
import { positionScore, roleFitScore } from './selection';
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
 *    retirements signs from the pool rather than inventing a man, so the world's
 *    total of footballers is conserved and the pool is a market with both sides
 *    in it. What it signs is decided by the squad reading in
 *    `recruitment/needs.ts` — the same reading the manager's recruitment screen
 *    prints — so it signs for a position it is genuinely short in, and takes the
 *    men it has just let go first.
 *
 * Both are seeded per club per season, so the same career signs the same men.
 * There is no scouting, no negotiation and no agent: a club sees the pool, reads
 * its own squad, and fills what is missing. That is the whole of it, and it is
 * enough.
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
  /**
   * A club in the red signs only what it cannot do without.
   *
   * There is no transfer fee and no wage bill here — a Sunday club does not pay
   * for a player — but a club whose books are in the negative is being kept
   * alive by the committee, and it stops adding men it does not need. This is
   * the only financial constraint the world has, and it is deliberately narrow:
   * it never stops a club filling a hole or reaching the legal minimum.
   */
  strainedSignings: 1,
  /**
   * How much better than the club's own man a signing has to be to displace
   * him, measured in role fit.
   *
   * A club that signs a marginally better footballer into a position it already
   * answers well is churning its own squad, not strengthening it. Six points of
   * role fit is roughly "he can play the job" rather than "he is the same man
   * again", and it is why the pyramid stops looking like a carousel.
   */
  displacementMargin: 0.06,
} as const;

/**
 * How good a footballer has to be at a job before a club will sign him for it.
 *
 * Below this he is not a candidate for that position at all, however badly the
 * club needs a body: a side short at centre half is better off with a full back
 * filling in than with a fourth-choice winger who cannot head it.
 */
const MIN_JOB_FIT = 0.4;

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
 * What one AI club intends to do this summer, in a form a person can read.
 *
 * The whole of the club's recruitment decision is in here — how short it is,
 * how many men it will actually take on, where it needs them and in what order
 * — and it is a pure reading of the state, so a test (or a debugger) can ask
 * what a club will do and why without running the summer. `clubSignsFromPool`
 * is the only caller that then acts on it.
 */
export interface AiSigningPlan {
  /** The size the club is trying to be, after the division's cap. */
  target: number;
  /** How many men short of that it is. */
  shortfall: number;
  /** How many it will sign this summer, which is never more than it needs. */
  budget: number;
  /** True when the club is in the red, and is therefore shopping narrowly. */
  strained: boolean;
  /** One entry per man let go, in the order he went: the exact positions to refill. */
  replacements: SigningPriority[];
  /** The club's own reading behind them, at most one position per area of the side. */
  priorities: SigningPriority[];
  /** The positions the caller said had just been released. */
  replacing: PositionCode[];
}

/**
 * How urgent a replacement is against the club's own needs.
 *
 * A man the club has just let go is a hole it already knows about, and it is
 * filled first — but it is a known hole rather than an urgent one, so it sits a
 * shade behind the position the club has nobody at all for. Both are filled in a
 * summer where the budget runs to it.
 */
const REPLACEMENT_WEIGHT = 0.85;

/** What a body is worth when the club cannot find anybody for the job it wants. */
const FALLBACK_WEIGHT = 0.3;

/**
 * One club's summer shopping list.
 *
 * Three constraints, in order of how much they bind:
 *
 *  - the club does not sign more men than it is short of, so a side at its
 *    target size signs nobody (`shortfall`);
 *  - a club in the red signs one man, and only to cover what it cannot cover
 *    (`strainedSignings`);
 *  - what it signs has to answer a real need: the men it has just let go, and
 *    then the holes the squad reading found.
 *
 * Replacements are per man and the club's needs are per area, and the two are
 * kept apart deliberately. A club that lets two centre halves go has two centre
 * halves to replace — that is not "shopping at the back", it is standing still,
 * and a rule of one signing per area applied to it would quietly shrink the
 * squad every summer.
 */
export function aiSigningPlan(
  state: GameState,
  club: Club,
  targetSquadSize: number,
  options: { cap?: number; positions?: readonly PositionCode[]; assessment?: SquadAssessment } = {},
): AiSigningPlan {
  const cap = options.cap ?? Number.POSITIVE_INFINITY;
  const target = Math.max(0, Math.min(targetSquadSize, cap));
  const shortfall = Math.max(0, target - club.squadIds.length);
  const strained = club.finances.balance < 0;
  const budget = Math.min(shortfall, strained ? AI_CLUBS.strainedSignings : AI_CLUBS.maxSigningsPerSeason);

  const assessment = options.assessment ?? squadAssessment(state, club.id);
  // One entry per man let go, in the order he went, so a club that released two
  // centre halves has two centre halves to find rather than one position to
  // fill twice. `replacing` is kept as the caller gave it — the record of what
  // was released — and the reading of it is `replacements`.
  const replacing = [...(options.positions ?? [])];
  const replacements = replacing.map((position) => replacementPriority(club, position));
  // The club's own reading, with the positions it is already replacing left out:
  // it is looking for those anyway, and a list that names the same position
  // twice reads as two different needs.
  const releasedPositions = new Set(replacing);
  const priorities = assessment.priorities.filter((entry) => !releasedPositions.has(entry.position));

  return { target, shortfall, budget, strained, replacements, priorities, replacing };
}

/**
 * The job a club is replacing, for a man it has just let go.
 *
 * Built from the club's own instructions like every other reading of a squad, so
 * a direct side replacing a full back asks for a defending one: the roles here
 * are the roles the tactics screen offers at that position, from the one table
 * the selection screen and the match engine both read.
 */
function replacementPriority(club: Club, position: PositionCode): SigningPriority {
  const roles = roleCandidates(position, club.tactics);
  const role = roles[0] ?? defaultRoleFor(position);
  return {
    position,
    group: POSITIONS[position].group,
    roles,
    roleLabel: roleProfile(role).label,
    weight: REPLACEMENT_WEIGHT,
    reason: `Replacing the ${POSITIONS[position].label.toLowerCase()} he let go.`,
  };
}

/**
 * One club's summer: sign whoever it needs from the pool.
 *
 * Only gaps are filled, against a target the caller sets. A club that retires
 * two men and releases one signs three, back to the size it was; a club that
 * loses nobody to retirement and releases nobody signs nobody, which is what
 * stops every squad in the pyramid growing in step.
 *
 * What changed when the squad reading arrived: the gap used to be filled with
 * the best footballer available, whoever he was and wherever he played. That is
 * not how a club signs, and with thirty-six of them doing it the county's squads
 * drifted into shapes nobody chose — a village side with five centre forwards
 * and one full back, every summer adding a man it did not need and letting go of
 * one who was not the problem. Now the club shops from `aiSigningPlan`: the men
 * it has just released, then the holes the squad reading found, in that order,
 * and only men who can actually do the job at the position being filled.
 *
 * `options.positions` is what the caller released, so a club that let a keeper go
 * signs a keeper. It is a hint and not an order — if nobody in the county can
 * play in goal, the club still fills its other holes.
 */
export function clubSignsFromPool(
  state: GameState,
  club: Club,
  rng: Rng,
  seasonStart: ISODate,
  targetSquadSize: number,
  options: { cap?: number; replaces?: readonly number[]; positions?: readonly PositionCode[] } = {},
): PlayerId[] {
  const signed: PlayerId[] = [];

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

  // Read the squad once, and shop from that reading. The assessment is the same
  // one the manager's own recruitment screen prints, so an AI club and the man
  // next to it are looking at the same football rather than at two opinions
  // about it.
  const assessment = squadAssessment(state, club.id);
  const plan = aiSigningPlan(state, club, targetSquadSize, {
    cap: options.cap,
    positions: options.positions,
    assessment,
  });
  if (plan.budget <= 0) return signed;

  const signedIds = new Set<string>();
  // The areas of the side this summer's business has already touched. A club
  // addresses each of them once: a side short at the back replaces what it lost
  // at the back and does not also go shopping there in the same summer, and a
  // need it cannot reach this year is still there in the next reading.
  const addressed = new Set<PositionGroup>();
  // Replacements are counted by the man rather than by the area, because the
  // club owes one signing per man it let go — two centre halves let go are two
  // centre halves to find, which is standing still rather than shopping.
  const refilled = new Set<number>();

  for (let attempt = 0; attempt < plan.budget; attempt += 1) {
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
    // what keeps the pool a market rather than a waiting room. It is the *first*
    // man only, and the fallback below still has to be a footballer.
    const field = available.length > 0
      ? available
      : attempt === 0
        ? pool.filter((person) => rating(person) <= ceiling)
        : [];
    if (field.length === 0) break;

    const best =
      bestAnswer(field, plan, { addressed, refilled }, assessment, floor, club, rng) ??
      // There is a need and nobody in the county can do the job the club is short
      // in. A club below the size it wants to be still signs somebody rather than
      // nobody — that is what stops a squad eroding into the emergency top-up
      // loop — but it is the best footballer who does not pile another man onto
      // an area it has already dealt with this summer, not a licence to sign the
      // best four men in the county.
      bestFallback(field, plan, { addressed, refilled }, floor, club, rng);
    if (!best) break;

    signPlayer(state, club, best.player, seasonStart, `cover ${POSITIONS[best.position].label.toLowerCase()}`);
    signedIds.add(best.player.id);
    if (best.replacement !== null) refilled.add(best.replacement);
    addressed.add(POSITIONS[best.position].group);
    signed.push(best.player.id);
  }
  return signed;
}

/** A candidate, with the need he answers and how well he answers it. */
interface Answered {
  player: Player;
  /** The replacement he is filling, by index, or null when he answers a club need. */
  replacement: number | null;
  /** The position he was signed for. */
  position: PositionCode;
  fit: number;
  score: number;
}

/**
 * Which of the club's needs this summer's next man answers, if any.
 *
 * The shopping list is worked in order — the men it has let go, in the order
 * they went, then the club's own reading — and each hole takes the best man who
 * can do that job. Two things stop a signing nobody needed:
 *
 *  - he has to be good enough at the job (`MIN_JOB_FIT`), measured by the same
 *    role-fit table the selection screen and the engine use; and
 *  - where he is not replacing anybody, and the club already answers that
 *    position well, he has to be clearly better than the man in possession
 *    (`displacementMargin`) rather than merely available.
 *
 * That second rule is the one that matters for a squad's shape. A club replacing
 * the right back it released is not displacing anybody — there is a hole where
 * that man stood, and the only question is whether the candidate can do the job
 * — while a club shopping into a position it already answers well has to justify
 * the signing, and that is the signing which used to churn a squad for no gain.
 */
function bestAnswer(
  field: readonly Player[],
  plan: AiSigningPlan,
  done: { addressed: ReadonlySet<PositionGroup>; refilled: ReadonlySet<number> },
  assessment: SquadAssessment,
  floor: number,
  club: Club,
  rng: Rng,
): Answered | null {
  // The men it let go first, hole by hole: the first replacement it can fill
  // takes the signing, and a hole nobody in the county can fill is passed over
  // rather than stopping the summer.
  for (let index = 0; index < plan.replacements.length; index += 1) {
    if (done.refilled.has(index)) continue;
    const priority = plan.replacements[index]!;
    let best: Answered | null = null;
    for (const player of field) {
      const fit = bestFit(player, priority);
      if (fit < MIN_JOB_FIT) continue;
      const score = signingScore({ player, fit, weight: priority.weight, floor, club, rng });
      if (best === null || score > best.score) {
        best = { player, replacement: index, position: priority.position, fit, score };
      }
    }
    if (best) return best;
  }

  // Then the club's own reading, one position per area of the side.
  for (const priority of plan.priorities) {
    if (done.addressed.has(priority.group)) continue;
    const slot = assessment.slots.find((entry) => entry.position === priority.position);
    let best: Answered | null = null;
    for (const player of field) {
      const fit = bestFit(player, priority);
      if (fit < MIN_JOB_FIT) continue;
      if (slot && !slot.thin && fit < slot.best + AI_CLUBS.displacementMargin) continue;
      const score = signingScore({ player, fit, weight: priority.weight, floor, club, rng });
      if (best === null || score > best.score) {
        best = { player, replacement: null, position: priority.position, fit, score };
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * The best footballer available, for a club that cannot find anybody to do the
 * job it wanted.
 *
 * It is still a choice rather than a shrug: the man's own position has to be an
 * area the club has not already dealt with this summer, so a club signing a
 * body it does not strictly need at least does not sign it at the position it
 * has just filled. Only when every area has been dealt with does it take the
 * best of what is left.
 */
function bestFallback(
  field: readonly Player[],
  plan: AiSigningPlan,
  done: { addressed: ReadonlySet<PositionGroup>; refilled: ReadonlySet<number> },
  floor: number,
  club: Club,
  rng: Rng,
): Answered | null {
  const spread = field.filter((player) => !done.addressed.has(player.positionGroup));
  const candidates = spread.length > 0 ? spread : field;
  // Only the holes still open count as a reason to sign a particular man: a
  // replacement the club has already filled is no longer a need, and reading it
  // as one is how a summer ends up with two goalkeepers and no centre forward.
  const open = plan.replacements.filter((_, index) => !done.refilled.has(index));
  let best: Answered | null = null;
  for (const player of candidates) {
    const priority = [...open, ...plan.priorities].find(
      (entry) => entry.group === player.positionGroup,
    );
    const role = priority?.roles[0] ?? defaultRoleFor(player.preferredPosition);
    const position = priority?.position ?? player.preferredPosition;
    const fit = priority ? bestFit(player, priority) : roleFitScore(player, player.preferredPosition, role);
    const score = signingScore({
      player,
      fit,
      weight: priority?.weight ?? FALLBACK_WEIGHT,
      floor,
      club,
      rng,
    });
    if (best === null || score > best.score) {
      best = { player, replacement: null, position, fit, score };
    }
  }
  return best;
}

/**
 * How well a man answers a hole, or nothing at all.
 *
 * Two questions, in order, and the first one is a gate rather than a score: can
 * he play the position (`PLAYABLE_AT`, the same line the squad reading counts
 * cover with), and then how well does he do the job the club asks there. Without
 * the gate a goalkeeper is a centre half by attribute overlap, and a club does
 * not replace its centre half with a keeper.
 */
function bestFit(player: Player, priority: SigningPriority): number {
  if (positionScore(player, priority.position) < PLAYABLE_AT) return 0;
  return priority.roles.reduce((best, role) => Math.max(best, roleFitScore(player, priority.position, role)), 0);
}

/**
 * How attractive a candidate is, once he answers a need at all.
 *
 * The need leads and the job comes second, because that is the order a real club
 * thinks in: a side with no goalkeeper signs the best goalkeeper it can, not the
 * best footballer in the county. Ability still counts, inside the band the club
 * is allowed to shop in; a local lad is preferred to a stranger; age is a brake;
 * and the noise is what keeps two villages from signing the same man's twin.
 */
function signingScore(input: {
  player: Player;
  fit: number;
  weight: number;
  floor: number;
  club: Club;
  rng: Rng;
}): number {
  const { player, fit, weight, floor, club, rng } = input;
  const need = weight * 3;
  const job = fit * 2;
  const quality = Math.max(0, rating(player) - floor) * 1.2;
  const local = player.townId === club.townId ? 0.9 : 0;
  const age = Math.min(1.5, Math.max(0, (player.age - 30) * 0.15));
  return need + job + quality + local + rng.float(0, 1.2) - age;
}



/**
 * Put a player on a club's books.
 *
 * Shared by the AI and the manager's own recruitment so a signing made either
 * way leaves the same records behind: the squad list, the relationships with the
 * men he will be playing with, and the candidate file cleared out.
 */
export function signPlayer(
  state: GameState,
  club: Club,
  player: Player,
  seasonStart: ISODate,
  reason?: string,
): void {
  const previousClubId = player.clubId;
  player.clubId = club.id;
  player.homeGroundId = club.groundId;
  player.registered = true;
  player.roles = [{ clubId: club.id, role: 'player', since: seasonStart }];
  // Where the signing came from is written on the man's own record, so a squad
  // list can say why a club signed him rather than merely that it did: an AI
  // club's decision is explainable after the fact, which is what makes a summer
  // of thirty-six clubs debuggable at all.
  const line = `Signed for ${club.identity.name}${reason ? ` to ${reason}` : ''}.`;
  player.notes = [...player.notes.filter((note) => !note.startsWith('Signed')), line];
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