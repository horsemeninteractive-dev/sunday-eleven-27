import type { InjuryDetail } from '@/domain/match';
import type { Player } from '@/domain/person';
import type { Rng } from '../../rng';

/**
 * Injuries in the match.
 *
 * A match can hurt a man, and most Sunday League injuries are knocks and
 * strains: a dead leg you run off, a twisted ankle you do not. This is the roll
 * and the severity, kept apart from the engine's step loop so the same
 * distribution is used wherever a knock is picked and so the football can be
 * read without it. The player's hidden susceptibility and how tired he is do the
 * raising; the pitch and the weather reach it through the conditions' injury
 * rate, passed in by the caller.
 */

/** Per player per minute, before susceptibility, tiredness and conditions. */
export const BASE_INJURY_RATE = 0.00055;

/**
 * How often the injury roll is made, in football seconds.
 *
 * The old engine rolled once a minute; the new one has no minute loop, so it
 * rolls on this cadence instead and scales the per-minute rate down to match.
 * Rolling every step would be hundreds of thousands of rolls for a figure that
 * barely moves from one step to the next.
 */
export const INJURY_CHECK_SECONDS = 5;

/**
 * How bad it is, and how long he is out.
 *
 * Serious ones are rare enough to be genuinely memorable; a bad pitch and a
 * tired body raise the odds of the middle categories, not of a broken leg.
 */
export function pickInjury(rng: Rng, player: Player, energy: number, injuryRate: number): InjuryDetail {
  const susceptibility = player.attributes.hidden.injurySusceptibility;
  const tiredness = 1 + (100 - energy) / 140;
  const seriousChance = 0.022 * injuryRate * (0.6 + susceptibility / 20);
  const moderateChance = 0.1 * injuryRate * tiredness;
  const minorChance = 0.28 * tiredness;

  const roll = rng.next();
  let severity: InjuryDetail['severity'];
  if (roll < seriousChance) severity = 'serious';
  else if (roll < seriousChance + moderateChance) severity = 'moderate';
  else if (roll < seriousChance + moderateChance + minorChance) severity = 'minor';
  else severity = 'knock';

  const descriptions: Record<InjuryDetail['severity'], string[]> = {
    knock: ['a dead leg', 'a knock on the ankle', 'a bang on the knee', 'a cut above the eye'],
    minor: ['a twisted ankle', 'a tight hamstring', 'a pulled calf', 'bruised ribs', 'a groin strain'],
    moderate: ['a hamstring tear', 'a badly rolled ankle', 'a medial knee strain', 'a shoulder injury'],
    serious: ['a suspected broken leg', 'cruciate ligament damage', 'a dislocated shoulder', 'a fractured collarbone'],
  };
  const daysOut =
    severity === 'knock'
      ? rng.int(0, 3)
      : severity === 'minor'
        ? rng.int(4, 12)
        : severity === 'moderate'
          ? rng.int(14, 38)
          : rng.int(60, 240);

  return { description: rng.pick(descriptions[severity]), severity, daysOut };
}
