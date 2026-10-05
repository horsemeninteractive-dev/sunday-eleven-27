import { ClubLink, PlayerLink } from './Links';
import { Panel } from './primitives';
import type { CompetitionStats, StatRow } from '@/simulation/tables';

/**
 * The record books of a competition.
 *
 * A table of standings says where everybody is; it says nothing about who is
 * actually scoring, and a manager deciding whether to spend money needs the
 * other half. These charts are read straight out of the performances the match
 * engine already recorded, so they cannot disagree with the results they were
 * built from.
 *
 * An empty chart says so rather than printing a dash: a competition three games
 * old has a top scorer with one goal and nothing worth calling a chart of
 * assists, and pretending otherwise would be a lie told in a table.
 */
export function Statistics({ stats, subtitle }: { stats: CompetitionStats; subtitle: string }) {
  if (stats.matchesPlayed === 0) {
    return (
      <Panel title="Statistics" subtitle={subtitle}>
        <p className="empty">Nothing has been played in this competition yet.</p>
      </Panel>
    );
  }

  return (
    <>
      <div className="split">
        <Panel title="Top scorers" subtitle={subtitle}>
          <StatChart rows={stats.scorers} value={(row) => `${row.goals}`} empty="Nobody has scored yet." />
        </Panel>
        <Panel title="Top assists" subtitle={subtitle}>
          <StatChart rows={stats.assists} value={(row) => `${row.assists}`} empty="No assists to show yet." />
        </Panel>
      </div>

      <div className="split">
        <Panel
          title="Highest rated"
          subtitle={
            stats.averageRating === null
              ? subtitle
              : `${subtitle} · competition average ${stats.averageRating.toFixed(1)}`
          }
        >
          <StatChart
            rows={stats.ratings}
            value={(row) => (row.rating === null ? '—' : row.rating.toFixed(1))}
            note={(row) => `${row.appearances} apps`}
            empty="Not enough games for an average rating yet."
          />
        </Panel>
        <Panel title="Discipline" subtitle={subtitle}>
          <div className="statcards__pair">
            <div>
              <p className="small muted statcards__heading">Yellow cards</p>
              <StatChart rows={stats.yellowCards} value={(row) => `${row.yellowCards}`} empty="Nobody has been booked." />
            </div>
            <div>
              <p className="small muted statcards__heading">Red cards</p>
              <StatChart rows={stats.redCards} value={(row) => `${row.redCards}`} empty="Nobody has been sent off." />
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

function StatChart({
  rows,
  value,
  note,
  empty,
}: {
  rows: StatRow[];
  value: (row: StatRow) => string;
  /** A second column when the number alone would mislead, such as appearances. */
  note?: (row: StatRow) => string;
  empty: string;
}) {
  if (rows.length === 0) return <p className="empty">{empty}</p>;
  return (
    <table className="statcards">
      <tbody>
        {rows.map((row) => (
          <tr key={row.playerId}>
            <td className="statcards__name">
              <PlayerLink personId={row.playerId} />
            </td>
            <td className="statcards__club">
              <ClubLink clubId={row.clubId} />
            </td>
            <td className="statcards__note">{note ? note(row) : ''}</td>
            <td className="statcards__value">{value(row)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}