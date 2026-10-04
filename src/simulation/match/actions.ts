import type { FieldZone } from '@/domain/match';
import type { PositionCode } from '@/domain/positions';
import type { Tactics } from '@/domain/tactics';
import type { Rng } from '../rng';
import type { PlayerEffectiveness } from './teamStrength';
import type { TacticalProfile } from './tacticsModel';
import { longShotPenalty, mayShootFrom, weightFor, type RoleProfile } from './roles';

/**
 * What a player decides to do with the ball.
 *
 * The old engine asked "did a shot happen this minute?" and then, separately,
 * "who shot?". That is why the football read as a list of incidents: the ball was
 * never anybody's, so there was nothing to decide. Here a player has the ball at
 * a place on a pitch with men around him, and the question is the one a footballer
 * actually answers — play it, carry it, take him on, put it in the box, have a go,
 * or get rid.
 *
 * Every weight below is a piece of football reasoning rather than a probability
 * dial. A centre-back on the edge of his own box with a striker closing is very
 * likely to clear it; the same man in acres of space in midfield looks for a
 * pass. A winger in the final third with the ball on his left foot and nobody
 * near him is a cross or a carry, never a clearance. Two things follow from that:
 * the balance is readable — you can look at a weight and argue with it — and
 * quality matters, because most of these weights are scaled by the attribute the
 * action actually uses.
 */

export type ActionKind = 'pass' | 'carry' | 'dribble' | 'cross' | 'shoot' | 'clear' | 'hold' | 'switch' | 'through';

export interface ActionOption {
  kind: ActionKind;
  weight: number;
  /** Why the weight is what it is, for the developer trace. */
  why: string;
}

export interface ActionContext {
  position: PositionCode;
  /**
   * What this man is for, as opposed to where he stands.
   *
   * This is what makes two sides with the same formation and the same
   * instructions play differently: everything below already knows a ball on the
   * flank in the final third is worth crossing, and the role decides whether
   * *this* man crosses it. It is also the only thing that can take an option out
   * of the table entirely — see {@link weighActions}.
   */
  role: RoleProfile;
  isKeeper: boolean;
  progress: number;
  /** Across the pitch, 0..1; the wings are near the edges. */
  y: number;
  zone: FieldZone;
  /** 0..1 how hard he is being closed down. */
  pressure: number;
  /** Teammates he could play it to, and how many of those are ahead of him. */
  optionsTotal: number;
  optionsAhead: number;
  /**
   * How many of those ahead are roles that actually make runs beyond the ball.
   *
   * A through ball is only on the menu if somebody is willing to chase it, so
   * this is what stops a deep-lying midfielder rolling a pass into a channel
   * that nobody in this side ever runs into.
   */
  runnersAhead: number;
  optionsWide: number;
  effective: PlayerEffectiveness['effective'];
  /** 0..100 in-match energy. */
  energy: number;
  profile: TacticalProfile;
  /** The instructions themselves, for the choices the multipliers do not carry. */
  tactics: Tactics;
  /** How hard his side is chasing the game, -1..1 (positive = chasing). */
  urgency: number;
  /** True when his side is protecting a lead and would happily slow it down. */
  retaining: boolean;
  /** True on the first touch of a counter-attack, when the pitch is open. */
  counter: boolean;
}

function a(value: number): number {
  return Math.max(0, Math.min(1, value / 20));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Weigh every action open to the man on the ball.
 *
 * Exposed separately from the choice itself so the developer trace can print
 * the whole table — a decision that looks wrong is almost always a *weight* that
 * is wrong, and reading the table is how that gets found.
 */
export function weighActions(ctx: ActionContext): ActionOption[] {
  const e = ctx.effective;
  const pa = a(e.passing);
  const bc = a(e.ballControl);
  const sk = a(e.shooting);
  const cr = a(e.crossing);
  const de = a(e.decisions);
  const co = a(e.composure);
  const pace = a(e.pace);
  const ag = a(e.agility);
  const det = a(e.determination);
  const pressure = clamp01(ctx.pressure);
  const wide = Math.abs(ctx.y - 0.5) > 0.24;

  const options: ActionOption[] = [];
  const add = (kind: ActionKind, weight: number, why: string) => {
    // Every weight the table produces is scaled by what this man is for. The
    // base model's job is to judge the situation; the role's is to judge the
    // man. A kind the role has no opinion about is left alone.
    //
    // Shooting is the exception, and the veto is applied first because it is the
    // one thing a role can take off the table entirely: a role that carries a
    // shotZones list may only shoot from those zones, and an empty list means he
    // never shoots at all. No amount of ability, pressure or urgency can offer
    // the option back, which is what stops a centre-half volleying from thirty
    // yards.
    //
    // What survives the veto is then discounted if it is a long-range effort, so
    // that letting one through is not the same as encouraging one.
    const scaled =
      kind === 'shoot' && !mayShootFrom(ctx.role, ctx.zone)
        ? 0
        : weight * weightFor(ctx.role, kind) * (kind === 'shoot' ? longShotPenalty(ctx.zone) : 1);
    if (scaled > 0) options.push({ kind, weight: scaled, why });
  };

  // --- Distribution from the keeper -----------------------------------------
  if (ctx.isKeeper) {
    add('pass', 2.4 * (0.5 + 0.9 * pa) * (1 - 0.35 * pressure), 'keeper playing out');
    add('clear', 1.1 * (1 + 1.2 * pressure) * (1.4 - 0.5 * de), 'keeper going long under pressure');
    add('hold', 0.25, 'keeper delaying');
    return options;
  }

  // --- Passing: the default ------------------------------------------------
  let wPass = 1.2 * (0.55 + 0.9 * pa) * (0.7 + 0.3 * Math.min(1, ctx.optionsTotal / 4));
  wPass *= 1 - 0.3 * pressure;
  if (ctx.tactics.passingStyle === 'short') wPass *= 1.18;
  if (ctx.tactics.passingStyle === 'direct') wPass *= 0.84;
  if (ctx.counter) wPass *= 0.9;
  add('pass', wPass, 'finding a teammate');

  // --- Carrying: space ahead and the legs to use it ------------------------
  let wCarry = 0.6 * (0.5 + 0.9 * bc) * (0.55 + 0.65 * pace);
  wCarry *= 1 - 0.7 * pressure;
  wCarry *= ctx.progress < 0.66 ? 1.15 : 0.7;
  if (ctx.tactics.tempo === 'high') wCarry *= 1.12;
  if (ctx.tactics.passingStyle === 'direct') wCarry *= 1.06;
  if (ctx.counter) wCarry *= 1.3;
  add('carry', wCarry, 'driving into space');

  // --- Dribbling: taking a man on ------------------------------------------
  let wDribble = 0.18 * (0.35 + 1.0 * bc) * (0.5 + 0.7 * ag) * (0.4 + 0.8 * det);
  wDribble *= pressure > 0.42 ? 1.3 : 0.7;
  if (ctx.zone === 'own-third' || ctx.zone === 'own-box') wDribble *= 0.4;
  if (ctx.zone === 'final-third' || ctx.zone === 'box') wDribble *= 1.3;
  if (wide) wDribble *= 1.15;
  add('dribble', wDribble, 'taking his man on');

  // --- Crossing: from wide and high up the pitch ---------------------------
  if (ctx.progress > 0.56 && wide) {
    let wCross = 0.9 * (0.3 + 1.0 * cr) * (0.6 + 0.7 * ctx.profile.wideBias);
    wCross *= 1 - 0.3 * pressure;
    wCross *= 0.65 + 0.35 * Math.min(1, ctx.optionsAhead / 2);
    add('cross', wCross, 'putting it in the box');
  }

  // --- Shooting: only from where a shot is a shot --------------------------
  if (ctx.progress > 0.6) {
    const nearness = clamp01((ctx.progress - 0.6) / 0.32);
    let wShoot = 1.2 * Math.pow(nearness, 1.9) * (0.28 + 1.15 * sk) * (0.6 + 0.6 * co);
    wShoot *= 1 - 0.45 * pressure;
    if (ctx.zone === 'box') wShoot *= 1.7;
    wShoot *= 1 + Math.max(0, ctx.urgency) * 0.5;
    add('shoot', wShoot, 'having a go');
  }

  // --- Clearing: the honest option in your own third -----------------------
  let wClear = 0;
  if (ctx.zone === 'own-box') wClear = 0.62;
  else if (ctx.zone === 'own-third') wClear = 0.34;
  if (wClear > 0) {
    wClear *= 1 + 1.7 * pressure;
    wClear *= 1.7 - 0.95 * de;
    wClear *= 1.35 - 0.6 * co;
    if (ctx.tactics.passingStyle === 'direct') wClear *= 1.5;
    if (ctx.tactics.passingStyle === 'short') wClear *= 0.55;
    if (ctx.counter) wClear *= 0.5;
    add('clear', wClear, 'getting rid of it');
  }

  // --- Holding: shielding it, slowing it down ------------------------------
  // Holding the ball up is a real and frequent thing for a forward with his
  // back to goal while support arrives, not a last resort. Its base used to be
  // so small that a striker had essentially no option but to pass, which is why
  // they squared it instead of shielding it and waiting for a runner.
  let wHold = 0.14;
  if (ctx.retaining && ctx.zone !== 'own-box') wHold *= 2.2;
  if (pressure > 0.5 && ctx.progress > 0.6) wHold *= 1.9;
  if (ctx.optionsTotal === 0) wHold *= 3;
  add('hold', wHold, 'shielding the ball');

  // --- Switching: moving it away from the pressure -------------------------
  if (pressure > 0.38 && ctx.progress < 0.78) {
    let wSwitch = 0.22 * (0.3 + 0.9 * de) * (0.3 + 0.8 * pa);
    if (ctx.tactics.passingStyle === 'direct') wSwitch *= 1.4;
    if (ctx.optionsWide > 0) wSwitch *= 1.3;
    add('switch', wSwitch, 'switching the play');
  }

  // --- Through balls: for a runner beyond the line -------------------------
  if (ctx.progress > 0.38 && ctx.optionsAhead > 0 && ctx.runnersAhead > 0) {
    let wThrough = 0.26 * (0.3 + 1.0 * de) * (0.3 + 0.9 * pa);
    if (ctx.tactics.passingStyle === 'direct') wThrough *= 1.25;
    if (ctx.urgency > 0) wThrough *= 1 + 0.6 * ctx.urgency;
    if (ctx.counter) wThrough *= 1.9;
    wThrough *= 1 - 0.3 * pressure;
    add('through', wThrough, 'threading it through');
  }

  return options;
}

export interface ActionChoice {
  kind: ActionKind;
  options: ActionOption[];
}

/** Pick, from the table above, what the man on the ball actually tries. */
export function chooseAction(ctx: ActionContext, rng: Rng): ActionChoice {
  const options = weighActions(ctx);
  if (options.length === 0) return { kind: 'pass', options };
  const kind = rng.weighted(options.map((option) => ({ value: option.kind, weight: option.weight })));
  return { kind, options };
}
