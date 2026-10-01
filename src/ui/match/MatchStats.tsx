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

function rowsFrom(stats: Stats): Row[] {
  const rows: Row[] = [
    {
      key: 'possession',
      label: 'Possession',
      home: `${Math.round(stats.home.possession * 100)}%`,
      away: `${Math.round(stats.away.possession * 100)}%`,
      homeShare: stats.home.possession,
    },
  ];

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
 */
export function MatchStatsStrip({ match }: { match: Match }) {
  const stats = matchStats(match);
  const pairs: Array<{ label: string; home: number | string; away: number | string }> = [
    {
      label: 'Possession',
      home: `${Math.round(stats.home.possession * 100)}%`,
      away: `${Math.round(stats.away.possession * 100)}%`,
    },
    { label: 'Shots', home: stats.home.shots, away: stats.away.shots },
    { label: 'On target', home: stats.home.shotsOnTarget, away: stats.away.shotsOnTarget },
    { label: 'Corners', home: stats.home.corners, away: stats.away.corners },
    { label: 'Fouls', home: stats.home.fouls, away: stats.away.fouls },
    { label: 'Cards', home: stats.home.yellowCards + stats.home.redCards, away: stats.away.yellowCards + stats.away.redCards },
  ];

  return (
    <div className="statstrip" aria-label="Match stats">
      {pairs.map((pair) => (
        <span key={pair.label} className="statstrip__item">
          <span className="statstrip__label">{pair.label}</span>
          <strong className="statstrip__value">{pair.home}</strong>
          <span className="statstrip__value statstrip__value--away">{pair.away}</span>
        </span>
      ))}
    </div>
  );
}

export function MatchStatsPanel({ match }: { match: Match }) {
  const stats = matchStats(match);
  const rows = rowsFrom(stats);

  return (
    <div className="stats">
      <div className="stats__head">
        <h3>Match stats</h3>
        <span className="small muted">Last {stats.pressureWindow} minutes</span>
      </div>

      <div className="pressure" aria-label="Recent pressure">
        <span className="pressure__side pressure__side--home" style={{ flexGrow: 0.2 + stats.pressure.home }} />
        <span className="pressure__side pressure__side--away" style={{ flexGrow: 0.2 + stats.pressure.away }} />
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
