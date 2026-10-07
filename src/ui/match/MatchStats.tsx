import type { Match } from '@/domain/match';
import { matchStats, type MatchStats as Stats } from '@/simulation/match/stats';

/**
 * What the match has actually produced.
 *
 * Every figure is read from the record the engine writes — no panel here can
 * invent a number to fill a slot. A row with nothing in it is not shown at all:
 * telling a manager that both sides have had no offsides is not information.
 */

interface Row {
  key: string;
  label: string;
  home: string;
  away: string;
  homeShare: number;
}

/**
 * Whether the record actually carries possession.
 *
 * `matchStats` gives both sides half the ball when there are no possession
 * ticks at all, which is the right default for the *model* and the wrong thing
 * to print: a 50/50 bar shown because nothing was recorded is exactly the kind
 * of invented number this panel promises not to display. So the figure is only
 * offered when the ticks behind it exist.
 */
function hasPossession(match: Match): boolean {
  const ticks = match.possessionTicks;
  return Boolean(ticks && ticks.home + ticks.away > 0);
}

function rowsFrom(stats: Stats, possession: boolean): Row[] {
  const rows: Row[] = [];
  if (possession) {
    rows.push({
      key: 'possession',
      label: 'Possession',
      home: `${Math.round(stats.home.possession * 100)}%`,
      away: `${Math.round(stats.away.possession * 100)}%`,
      homeShare: stats.home.possession,
    });
  }

  const add = (key: string, label: string, home: number, away: number) => {
    if (home === 0 && away === 0) return;
    const total = home + away;
    rows.push({
      key,
      label,
      home: String(home),
      away: String(away),
      homeShare: total > 0 ? home / total : 0.5,
    });
  };

  add('shots', 'Shots', stats.home.shots, stats.away.shots);
  add('onTarget', 'On target', stats.home.shotsOnTarget, stats.away.shotsOnTarget);
  // Passes are shown as completed-of-attempted, because the attempt figure on
  // its own says nothing about how the side has played.
  const passTotals = stats.home.passes + stats.away.passes;
  if (passTotals > 0) {
    rows.push({
      key: 'passes',
      label: 'Passes (completed)',
      home: `${stats.home.passesCompleted}/${stats.home.passes}`,
      away: `${stats.away.passesCompleted}/${stats.away.passes}`,
      homeShare: stats.home.passes / passTotals,
    });
  }
  add('tackles', 'Tackles', stats.home.tackles, stats.away.tackles);
  add('interceptions', 'Interceptions', stats.home.interceptions, stats.away.interceptions);
  add('corners', 'Corners', stats.home.corners, stats.away.corners);
  add('fouls', 'Fouls', stats.home.fouls, stats.away.fouls);
  add('offsides', 'Offsides', stats.home.offsides, stats.away.offsides);
  add('yellow', 'Yellow cards', stats.home.yellowCards, stats.away.yellowCards);
  add('red', 'Red cards', stats.home.redCards, stats.away.redCards);
  return rows;
}

/**
 * The same numbers as a single line, for the strip under the match.
 *
 * The manager should be able to read the state of the game in one glance
 * without giving up any height to it — the detailed version is a tab away, and
 * is what half time and full time put in front of him.
 *
 * Each figure carries a swing bar: a see-saw pivoted in the middle, leaning
 * towards whichever side is winning it, in that side's *shirt*. Two numbers side
 * by side tell you the score of a battle; a row of bars leaning the same way
 * tells you at a glance which way the afternoon is going.
 */
export function MatchStatsStrip({
  match,
  homeColour,
  awayColour,
}: {
  match: Match;
  /** The first colour of the strip each side is actually wearing. */
  homeColour: string;
  awayColour: string;
}) {
  const stats = matchStats(match);
  const share = (home: number, away: number) => {
    const total = home + away;
    // Nothing has happened yet, so the bar rests level rather than claiming a
    // side is ahead of nothing.
    return total > 0 ? home / total : 0.5;
  };

  const pairs: Array<{ label: string; home: number | string; away: number | string; homeShare: number }> = [
    // Possession is offered only when the record has the ticks to support it,
    // for the same reason the detailed panel omits it: a bar resting at halfway
    // because nothing was recorded is not a 50/50 afternoon.
    ...(hasPossession(match)
      ? [{
          label: 'Possession',
          home: `${Math.round(stats.home.possession * 100)}%`,
          away: `${Math.round(stats.away.possession * 100)}%`,
          homeShare: stats.home.possession,
        }]
      : []),
    { label: 'Shots', home: stats.home.shots, away: stats.away.shots, homeShare: share(stats.home.shots, stats.away.shots) },
    {
      label: 'On target',
      home: stats.home.shotsOnTarget,
      away: stats.away.shotsOnTarget,
      homeShare: share(stats.home.shotsOnTarget, stats.away.shotsOnTarget),
    },
    { label: 'Corners', home: stats.home.corners, away: stats.away.corners, homeShare: share(stats.home.corners, stats.away.corners) },
    { label: 'Fouls', home: stats.home.fouls, away: stats.away.fouls, homeShare: share(stats.home.fouls, stats.away.fouls) },
    {
      label: 'Cards',
      home: stats.home.yellowCards + stats.home.redCards,
      away: stats.away.yellowCards + stats.away.redCards,
      homeShare: share(
        stats.home.yellowCards + stats.home.redCards,
        stats.away.yellowCards + stats.away.redCards,
      ),
    },
  ];

  return (
    <div className="statstrip" aria-label="Match stats">
      {pairs.map((pair) => (
        <span key={pair.label} className="statstrip__item">
          <span className="statstrip__label">{pair.label}</span>
          <span className="statstrip__reading">
            <strong className="statstrip__value">{pair.home}</strong>
            {/* The home half is anchored to the pivot and grows leftwards, so
                the joint between them lands at the home side's share of the
                figure: the bar leans towards whoever is ahead. A floor on each
                half keeps a one-sided figure visible rather than collapsing it
                to a hairline. */}
            <span className="statstrip__swing" aria-hidden="true">
              <span
                className="statstrip__swing-half statstrip__swing-half--home"
                style={{ flexGrow: Math.max(pair.homeShare, 0.06), background: homeColour }}
              />
              <span className="statstrip__swing-pivot" />
              <span
                className="statstrip__swing-half statstrip__swing-half--away"
                style={{ flexGrow: Math.max(1 - pair.homeShare, 0.06), background: awayColour }}
              />
            </span>
            <span className="statstrip__value statstrip__value--away">{pair.away}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

export function MatchStatsPanel({ match }: { match: Match }) {
  const stats = matchStats(match);
  const rows = rowsFrom(stats, hasPossession(match));
  if (rows.length === 0) {
    return (
      <div className="stats">
        <div className="stats__head">
          <h3>Match stats</h3>
        </div>
        <p className="empty small">
          Nothing has been recorded yet. This panel only reports what the match has actually produced.
        </p>
      </div>
    );
  }

  return (
    <div className="stats">
      <div className="stats__head">
        <h3>Match stats</h3>
        {/* The window belongs to the pressure bar and to nothing else. It used
            to be the note beside "Match stats", where it read as a claim about
            every row underneath — and the shots, passes and possession below
            are whole-match figures, so that was simply wrong. */}
        <span className="small muted">Whole match so far</span>
      </div>

      <div className="stats__pressure">
        <span className="small muted">Pressure · last {stats.pressureWindow} minutes</span>
        {/* A picture of a share, so it is named as one: a bare `aria-label` on a
            plain div is prohibited, and the bar carries no text of its own. */}
        <div className="pressure" role="img" aria-label={`Recent pressure over the last ${stats.pressureWindow} minutes`}>
          <span className="pressure__side pressure__side--home" style={{ flexGrow: 0.2 + stats.pressure.home }} />
          <span className="pressure__side pressure__side--away" style={{ flexGrow: 0.2 + stats.pressure.away }} />
        </div>
      </div>

      <dl className="stats__rows">
        {rows.map((row) => (
          <div key={row.key} className="stats__row">
            <dt className="stats__label">{row.label}</dt>
            <dd className="stats__value stats__value--home">{row.home}</dd>
            <span className="stats__bar" aria-hidden="true">
              <span className="stats__bar-home" style={{ width: `${row.homeShare * 100}%` }} />
            </span>
            <dd className="stats__value stats__value--away">{row.away}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
