import { KNOWLEDGE_CONFIDENCE_LABEL } from '@/domain/recruitment';
import { formatDate } from '@/simulation/calendar';
import {
  dossierFreshness,
  type DossierRead,
  type OppositionDossier,
  type OppositionMatch,
} from '@/simulation/intelligence/opposition';
import { Callout, Panel, Pill } from './primitives';

/**
 * What the manager knows about the side he is about to play.
 *
 * The reading itself is the simulation's (`intelligence/opposition.ts`): it
 * decides what was seen, who saw it, how much of it there is and whether a line
 * is a fact or a reading of one. This screen does no football at all — it takes
 * that reading and puts it in the order a manager would want it in on the
 * afternoon before a match:
 *
 *   1. how they set up, which is a fact about them rather than a guess;
 *   2. the two or three things that should change what he does;
 *   3. the detail behind those, each line carrying how many afternoons it rests
 *      on and who was there;
 *   4. the raw evidence — every match, and which of them anybody watched.
 *
 * The distinction the whole screen is built to keep is fact against reading. The
 * dossier already marks every read `fact` or `interpretation`, and a single
 * afternoon is never dressed up as a pattern: if nothing has been watched, the
 * screen says so plainly and prints the results, which are public and exact, and
 * nothing else.
 */

/** What a read is called up front. A read of the record is not the same as an inference from it. */
const KIND_LABEL: Record<DossierRead['kind'], string> = {
  fact: 'Seen',
  interpretation: 'Reading',
};

/** One read, as the screen prints it: the finding, then where it came from. */
export interface ReportRow {
  id: DossierRead['id'];
  title: string;
  lines: string[];
  source: string;
  matches: number;
  kind: DossierRead['kind'];
  kindLabel: string;
  confidenceLabel: string;
}

/**
 * The reads in the order the dossier wrote them, with the two labels a screen
 * needs resolved once: what kind of statement it is, and how far it can be
 * trusted. Both come from the read itself, so a line can never be printed as a
 * fact on one screen and a hunch on another.
 */
export function reportRows(dossier: OppositionDossier): ReportRow[] {
  return dossier.reads.map((read) => ({
    id: read.id,
    title: read.title,
    lines: read.lines,
    source: read.source,
    matches: read.matches,
    kind: read.kind,
    kindLabel: KIND_LABEL[read.kind],
    confidenceLabel: KNOWLEDGE_CONFIDENCE_LABEL[read.confidence],
  }));
}

/**
 * How much there is behind the report, in one line.
 *
 * A manager reading a report needs this before he reads anything else in it: it
 * is the difference between "we have watched them four times" and "we have seen
 * one afternoon of them", and it is the honest answer to how much of this he
 * should believe.
 */
export function evidenceLine(dossier: OppositionDossier): string {
  const { matches, watchedByYou, watchedByStaff, staffName } = dossier.evidence;
  if (matches === 0) return 'Nothing watched this season — their results, and nothing else.';
  const parts = [`${matches} match${matches === 1 ? '' : 'es'} watched`];
  if (watchedByYou > 0) parts.push(watchedByYou === matches ? 'all by you' : `${watchedByYou} by you`);
  if (watchedByStaff > 0) {
    parts.push(staffName ? `${watchedByStaff} by ${staffName}` : `${watchedByStaff} by the club`);
  }
  return `${parts.join(' · ')}. ${dossierFreshness(dossier)}.`;
}

/** One of their matches, in the evidence list: what happened, and who was there. */
function matchLine(entry: OppositionMatch, watched: boolean): string {
  const venue = entry.venue === 'H' ? 'h' : entry.venue === 'A' ? 'a' : 'n';
  const result = entry.outcome === 'W' ? 'won' : entry.outcome === 'D' ? 'drew' : 'lost';
  return `${formatDate(entry.date)} · ${venue} ${entry.score} v ${entry.opponentName} (${result}, ${entry.formation})${
    watched ? ` · ${entry.source === 'you' ? 'you were there' : 'watched by the club'}` : ''
  }`;
}

export function OppositionReport({
  dossier,
  className,
}: {
  dossier: OppositionDossier;
  className?: string;
}) {
  const rows = reportRows(dossier);
  const watching = new Set(dossier.observed.map((entry) => entry.matchId));

  return (
    <Panel
      level="primary"
      className={className}
      title={`What we know about ${dossier.clubShortName}`}
      subtitle={evidenceLine(dossier)}
      actions={
        <Pill tone={dossier.empty ? 'warn' : 'ok'} title="How many of their matches there is detail behind">
          {dossier.empty ? 'Nothing watched' : `${dossier.evidence.matches} watched`}
        </Pill>
      }
    >
      <div className="oppo">
        {/* Their instructions, which is a fact about them rather than a reading
            of anything: it is what their manager sends them out with. */}
        <div className="oppo__plan">
          <span className="letterpress">How they set up</span>
          <p className="oppo__plan-line">
            <b>{dossier.plan.formation}</b> · {dossier.plan.label}
          </p>
          {dossier.plan.lines.map((line) => (
            <p className="small muted" key={line}>
              {line}
            </p>
          ))}
        </div>

        {/* The honest answer first when there is very little of it. A manager
            should know how thin the report is before he reads a line of it. */}
        {dossier.empty && (
          <Callout tone="info" title="Only the results so far">
            <p className="small">
              Nobody has watched them yet, so there is nothing here about how they play. Their results are
              public and exact, and they are what you have until somebody gets to a match.
            </p>
          </Callout>
        )}

        {dossier.summary.length > 0 && (
          <section className="oppo__findings">
            <h3 className="subhead">What matters most</h3>
            <ul className="bullets">
              {dossier.summary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        )}

        {rows.length > 0 && (
          <section className="oppo__reads">
            <h3 className="subhead">Their game, up close</h3>
            <ul className="oppo__reads-list">
              {rows.map((row) => (
                <li className={`oppo__read oppo__read--${row.kind}`} key={row.id}>
                  <div className="oppo__read-head">
                    <span className="oppo__read-title">{row.title}</span>
                    <span className="oppo__read-meta">
                      <Pill
                        tone={row.kind === 'fact' ? 'muted' : 'accent'}
                        title={
                          row.kind === 'fact'
                            ? 'Read off what was watched'
                            : 'A reasonable inference from what was watched, not a fact'
                        }
                      >
                        {row.kindLabel}
                      </Pill>
                      <span className="muted small">
                        {row.confidenceLabel} · {row.matches} match{row.matches === 1 ? '' : 'es'}
                      </span>
                    </span>
                  </div>
                  <ul className="bullets">
                    {row.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <p className="muted small oppo__read-source">{row.source}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {dossier.keyPlayers.length > 0 && (
          <section className="oppo__players">
            <h3 className="subhead">Who to watch out for</h3>
            <div className="row row--wrap">
              {dossier.keyPlayers.map((player) => (
                <div className="oppo__player" key={player.playerId}>
                  <span className="oppo__player-name">
                    {player.name} <span className="muted small">{player.position}</span>
                  </span>
                  <span className="muted small">{player.note}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* The working, kept but not in the way: every match of theirs, newest
            first, and which of them anybody at the club actually saw. */}
        <details className="more">
          <summary>
            The evidence — {dossier.form}
          </summary>
          <p className="small muted">{evidenceLine(dossier)}</p>
          {dossier.results.length > 0 ? (
            <ul className="tight-list">
              {dossier.results.map((entry) => (
                <li key={entry.matchId} className="small">
                  {matchLine(entry, watching.has(entry.matchId))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No results yet this season.</p>
          )}
          <p className="muted small">
            Their shape and their goals are read from the matches above that somebody watched. The results
            themselves need no eyes on them: a Sunday manager reads them in the paper.
          </p>
        </details>
      </div>
    </Panel>
  );
}
