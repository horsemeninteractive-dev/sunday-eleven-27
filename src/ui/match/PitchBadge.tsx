import type { MatchConditions, PitchCondition } from '@/domain/match';
import { PITCH_LABEL } from '@/domain/match';
import { conditionEffects } from '@/simulation/match/tacticsModel';

/**
 * The surface, drawn, and what it does to the football.
 *
 * A matchday brief said `Pitch: Good` in the same 13px grey as the kick-off time
 * and the expected gate, which is the wrong weight for the one fact on the card
 * a manager picks a team and a team talk around: a wet, heavy pitch and a dry
 * one want different football, and nothing on the screen said so. It is a
 * drawing and a sentence now.
 *
 * Both are read from the simulation rather than written beside it — the notes
 * are thresholds on `conditionEffects`, the function the engine itself uses to
 * turn a surface into an error rate, a fatigue rate and an injury rate — so a
 * badge cannot promise a dry pitch when the engine is about to make every pass
 * bobble.
 *
 * The drawing is the sheet's own line: a 32-unit patch shown at 48px, drawn at
 * stroke-width 1, which is 1.5px on the screen — the same line every other
 * drawing in the game is made of (see `.news-plate`). It is decorative: the
 * condition is printed in words beside it, so it is hidden from a screen reader
 * rather than named twice.
 */

export interface PitchVerdict {
  /** How much trouble the surface is in, for the badge's own colour. */
  tone: 'ok' | 'warn' | 'bad';
  /** One or two short lines: what this surface does to the afternoon. */
  notes: string[];
}

/**
 * What the pitch does, as a tone and a sentence.
 *
 * The thresholds are the engine's own numbers, and they were picked by reading
 * what the six conditions actually come out as:
 *
 * | pitch | passing | error | fatigue | injury |
 * | --- | --- | --- | --- | --- |
 * | excellent / good | 0 | 1.00 | 1.00 | 1.00 |
 * | worn | 0.05 | 1.02 | 1.01 | 1.03 |
 * | muddy | 0.09 | 1.10 | 1.20 | 1.22 |
 * | waterlogged | 0.15 | 1.19 | 1.16 | 1.10 |
 * | frozen | 0.07 | 1.25 | 1.04 | 1.70 |
 *
 * Weather is in the same numbers: heavy rain adds 0.03 to the passing penalty
 * and 0.08 to the error rate on *any* surface, which is why the bobble tier
 * starts at 0.03 — a good pitch in a downpour is not a good pitch to pass on,
 * and a badge that called it one would be lying about the afternoon.
 *
 * So "more knocks" fires on a frozen pitch, "short passing gets harder" on a
 * waterlogged one, and legs go sooner in the mud. The lines come out in the
 * order a manager would say them in — who it will hurt first, then what the ball
 * will do, then how long the afternoon will last. `bad` is kept for the two
 * surfaces the league will actually call a game off for (see
 * `simulation/postponement.ts`), because a badge that shouts at a worn pitch is
 * a badge nobody reads.
 */
export function pitchVerdict(conditions: MatchConditions): PitchVerdict {
  const effects = conditionEffects(conditions);
  const notes: string[] = [];

  if (effects.injuryRate >= 1.5) notes.push('Hard on the legs and the ankles');
  else if (effects.injuryRate >= 1.18) notes.push('More knocks than usual');

  if (effects.passControlPenalty >= 0.12) notes.push('Short passing gets harder');
  else if (effects.passControlPenalty >= 0.03) notes.push('The ball will bobble about a bit');
  else if (effects.errorRate >= 1.1) notes.push('More misplaced touches');

  if (effects.fatigueRate >= 1.15) notes.push('Legs will go sooner');
  if (effects.shotQualityPenalty >= 0.02) notes.push('Shooting is a lottery');

  const calledOff = conditions.pitch === 'waterlogged' || conditions.pitch === 'frozen';
  if (notes.length === 0) {
    notes.push(conditions.pitch === 'excellent' ? 'A pitch to pass it on' : 'A fair surface for a game');
    return { tone: 'ok', notes };
  }
  return { tone: calledOff ? 'bad' : 'warn', notes };
}

/** The marks the day's condition leaves on the patch of grass. */
function conditionMarks(pitch: PitchCondition) {
  switch (pitch) {
    case 'excellent':
      return (
        <>
          <path d="M5 1v18M10 1v18M15 1v18M20 1v18M25 1v18" />
          <circle cx="16" cy="10" r="2" />
        </>
      );
    case 'good':
      return (
        <>
          <path d="M8 1v18M16 1v18M24 1v18" />
          <path d="M12 8l1 3 1-3M20 12l1 3 1-3" />
        </>
      );
    // A bald patch is the whole of a worn pitch: the grass has gone where the
    // game is always played and the ball skids off it.
    case 'worn':
      return (
        <>
          <ellipse cx="16" cy="10" rx="7" ry="4" />
          <path d="M6 15l1 3 1-3M25 4l1 3 1-3" />
        </>
      );
    // Clods: the ball sits up in the mud and the legs know about it.
    case 'muddy':
      return (
        <>
          <ellipse cx="11" cy="8" rx="2.6" ry="1.6" />
          <ellipse cx="19" cy="13" rx="3" ry="1.8" />
          <ellipse cx="24" cy="6" rx="2" ry="1.3" />
          <path d="M5 14l1 3 1-3M27 16l1 3 1-3" />
        </>
      );
    // Standing water: two puddles with a ripple across each.
    case 'waterlogged':
      return (
        <>
          <ellipse cx="12" cy="13" rx="5" ry="2.4" />
          <ellipse cx="22" cy="7" rx="4" ry="2" />
          <path d="M8 13h3M19 7h3" />
          <path d="M26 15l1 3 1-3" />
        </>
      );
    // Frost: the ground hatched over, squared up like the crystal it is.
    case 'frozen':
      return (
        <>
          <path d="M8 4l3 5M18 4l3 5M13 12l3 5M23 12l3 5" />
          <path d="M16 6v8M12.5 10h7" />
        </>
      );
  }
}

export function PitchBadge({ conditions, className }: { conditions: MatchConditions; className?: string }) {
  const tone = pitchVerdict(conditions).tone;
  return (
    <svg
      className={`pitch-badge pitch-badge--${tone}${className ? ` ${className}` : ''}`}
      viewBox="0 0 32 20"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0.5" y="0.5" width="31" height="19" rx="1" />
      {conditionMarks(conditions.pitch)}
    </svg>
  );
}

/** The pitch as one line of text, for a title or a log. */
export function pitchSummary(conditions: MatchConditions): string {
  const { notes } = pitchVerdict(conditions);
  return `${PITCH_LABEL[conditions.pitch]} pitch — ${notes[0]!.toLowerCase()}.`;
}
