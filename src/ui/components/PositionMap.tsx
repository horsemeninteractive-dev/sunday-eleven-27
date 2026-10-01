import type { Player } from '@/domain/person';
import { ALL_POSITION_CODES, POSITIONS, type PositionCode } from '@/domain/positions';
import { suitabilityFor } from '@/simulation/queries';

/**
 * Where a player can actually play, on a pitch.
 *
 * A profile used to list all twelve roles down the screen with a dot beside
 * each one, which told the manager the shape of the squad rather than the shape
 * of the player — and ate a third of the screen doing it. A pitch does the same
 * job in one glance: the dots sit where the positions are, and their weight is
 * how much of a role each one is.
 *
 * The weight is *familiarity*, not the match score. A centre half who has
 * played right back all season is not "almost his position" — he is a right
 * back — and a good player's unfamiliar role can out-score a poor player's own
 * one. What a squad sheet wants to know is who can go where.
 */

export type PositionBand = 'natural' | 'fill-in' | 'unsuited';

/** Out of 20: a role he is picked in, and one he can be asked to cover. */
export const NATURAL_FAMILIARITY = 14;
export const FILL_IN_FAMILIARITY = 8;

export const POSITION_BAND_LABEL: Record<PositionBand, string> = {
  natural: 'his positions',
  'fill-in': 'can fill in',
  unsuited: 'no use there',
};

export function bandFor(player: Player, code: PositionCode): PositionBand {
  if (code === player.preferredPosition) return 'natural';
  const familiarity = player.positionalFamiliarity[code] ?? 0;
  if (familiarity >= NATURAL_FAMILIARITY) return 'natural';
  if (familiarity >= FILL_IN_FAMILIARITY) return 'fill-in';
  return 'unsuited';
}

export interface PositionBands {
  natural: PositionCode[];
  fillIn: PositionCode[];
  unsuited: PositionCode[];
  /** Every role with its match score, best first. */
  scores: Array<{ code: PositionCode; score: number }>;
}

/** A player's roles, banded by familiarity and ordered by how good he is there. */
export function positionBands(player: Player): PositionBands {
  const scores = ALL_POSITION_CODES.map((code) => ({ code, score: suitabilityFor(player, code) })).sort(
    (a, b) => b.score - a.score,
  );
  return {
    natural: scores.filter((entry) => bandFor(player, entry.code) === 'natural').map((entry) => entry.code),
    fillIn: scores.filter((entry) => bandFor(player, entry.code) === 'fill-in').map((entry) => entry.code),
    unsuited: scores.filter((entry) => bandFor(player, entry.code) === 'unsuited').map((entry) => entry.code),
    scores,
  };
}

export function PositionMap({ player }: { player: Player }) {
  const bands = positionBands(player);
  const byCode = new Map(bands.scores.map((entry) => [entry.code, entry.score]));
  return (
    <div className="posmap">
      <div className="pitch pitch--static pitch--mini">
        <span className="pitch__halfway" />
        <span className="pitch__circle" />
        {ALL_POSITION_CODES.map((code) => (
          <span
            key={code}
            className={`posmap__dot posmap__dot--${bandFor(player, code)}`}
            style={{ left: `${POSITIONS[code].base.x * 100}%`, top: `${POSITIONS[code].base.y * 100}%` }}
            title={`${POSITIONS[code].label} — ${byCode.get(code) ?? 0}/100`}
          >
            {code}
          </span>
        ))}
      </div>
      <ul className="posmap__key">
        {(['natural', 'fill-in', 'unsuited'] as PositionBand[]).map((band) => {
          const codes = band === 'natural' ? bands.natural : band === 'fill-in' ? bands.fillIn : bands.unsuited;
          if (codes.length === 0) return null;
          // The pitch already names every role it draws, so the key only has to
          // say how many he cannot play — not list all eleven of them again.
          const unsuited = band === 'unsuited';
          return (
            <li className={`posmap__key-item posmap__key-item--${band}`} key={band} title={unsuited ? codes.join(', ') : undefined}>
              <span className={`posmap__swatch posmap__swatch--${band}`} aria-hidden="true" />
              <span className="muted small">{POSITION_BAND_LABEL[band]}</span>
              <strong className="small">{unsuited ? `${codes.length} roles` : codes.join(' · ')}</strong>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
