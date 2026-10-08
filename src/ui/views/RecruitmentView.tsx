import type { GameState } from '@/domain/game';
import type { PersonId } from '@/domain/ids';
import { isPlayer, personDisplayName } from '@/domain/person';
import {
  CANDIDATE_STATUS_LABEL,
  DISCOVERY_SOURCE_LABEL,
  type CandidateKnowledge,
  type RecruitmentCandidate,
  type SquadNeed,
} from '@/domain/recruitment';
import { fiveASideVenueFor } from '@/simulation/recruitment/discovery';
import { squadNeeds } from '@/simulation/recruitment/needs';
import { candidatesOf, recruitmentStore } from '@/simulation/recruitment/store';
import { gameActions, useGame } from '../hooks';
import { Button, PageHeader, Panel, Pill, SortTh } from '../components/primitives';
import { MetricTile, Section, Tile, TileGrid } from '../components/hierarchy';
import { PersonLine } from '../components/PersonIdentity';
import { Portrait } from '../components/Portrait';
import { useRememberedSort } from '../rememberedSort';
import { applySort, type SortAccessors } from '../tableSort';

/**
 * Recruitment.
 *
 * Everything on this screen is *what the manager knows*, and every belief
 * carries where it came from. There is no list of every unattached player in
 * the county and no rating to sort by: there is a squad that is short somewhere,
 * some lads who might know somebody, and a few names worth a look.
 */

const OPEN_STATUSES: Array<RecruitmentCandidate['status']> = ['watching', 'invited', 'trialled', 'approached'];

type NeedSortKey = 'area' | 'registered' | 'available' | 'reliable' | 'averageAge' | 'verdict';

const NEED_SORT: SortAccessors<SquadNeed, NeedSortKey> = {
  area: (need) => need.label,
  registered: (need) => need.registered,
  available: (need) => need.available,
  reliable: (need) => need.reliable,
  averageAge: (need) => need.averageAge,
  verdict: (need) => ['thin', 'ok', 'strong'].indexOf(need.verdict),
};

export function RecruitmentView() {
  const game = useGame();
  const [sort, setSort] = useRememberedSort('recruitment', game?.saveId ?? null, NEED_SORT);
  if (!game) return null;

  const club = game.clubs[game.userClubId]!;
  const store = recruitmentStore(game);
  const needs = squadNeeds(game, club.id);
  const candidates = candidatesOf(game).sort((a, b) => {
    const aOpen = OPEN_STATUSES.includes(a.status) ? 0 : 1;
    const bOpen = OPEN_STATUSES.includes(b.status) ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return b.discoveredOn.localeCompare(a.discoveredOn) || a.personId.localeCompare(b.personId);
  });
  const open = candidates.filter((candidate) => OPEN_STATUSES.includes(candidate.status));
  const closed = candidates.filter((candidate) => !OPEN_STATUSES.includes(candidate.status));

  const alreadyAsked = store.lastAskedOn === game.date;
  const alreadyWatched = store.lastFiveASideOn === game.date;
  const sessionThisWeek = store.lastOpenSessionOn === game.date;
  const awaitingSession = store.pendingTrialIds.length;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Club"
        title="Recruitment"
        subtitle="Find names through the local game, watch them, then talk terms."
        meta={
          <>
            <span className="small muted">{open.length} on the list</span>
            {awaitingSession > 0 && <span className="small muted">{awaitingSession} waiting on a session</span>}
            {needs.summary.length > 0 && <span className="small muted">{needs.summary[0]}</span>}
          </>
        }
      />

      <Section title="Squad needs">
        <TileGrid min={160}>
          {needs.positions.map((need) => (
            <MetricTile
              key={need.group}
              label={need.label}
              value={`${need.available}/${need.registered}`}
              note={
                need.verdict === 'thin' ? 'Light' : need.verdict === 'strong' ? 'Well covered' : 'Alright'
              }
              tone={need.verdict === 'thin' ? 'warn' : need.verdict === 'strong' ? 'ok' : 'default'}
            />
          ))}
        </TileGrid>
        {needs.summary.length > 0 && (
          <ul className="bullets" style={{ marginTop: 'var(--s2)' }}>
            {needs.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </Section>

      <details className="more">
        <summary className="small muted">Full breakdown by area</summary>
        <Panel tone={needs.thinGroups.length > 0 ? 'warn' : 'default'}>
        <div className="table-wrapper">
        <table className="table table--compact table--stack">
          <thead>
            <tr>
              <SortTh label="Area" sortKey="area" sort={sort} onSort={setSort} />
              <SortTh label="Registered" sortKey="registered" sort={sort} onSort={setSort} />
              <SortTh label="Available" sortKey="available" sort={sort} onSort={setSort} />
              <SortTh label="You can rely on" sortKey="reliable" sort={sort} onSort={setSort} className="col--opt" />
              <SortTh label="Average age" sortKey="averageAge" sort={sort} onSort={setSort} className="col--opt" />
              <SortTh label="Verdict" sortKey="verdict" sort={sort} onSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {applySort(needs.positions, sort, NEED_SORT).map((need) => (
              <tr key={need.group}>
                <td>{need.label}</td>
                <td data-label="Registered">{need.registered}</td>
                <td data-label="Available">{need.available}</td>
                <td className="col--opt" data-label="You can rely on">
                  {need.reliable}
                </td>
                <td className="col--opt" data-label="Average age">
                  {need.averageAge || '—'}
                </td>
                <td data-label="Verdict">
                  <Pill tone={need.verdict === 'thin' ? 'warn' : need.verdict === 'strong' ? 'ok' : 'muted'}>
                    {need.verdict === 'thin' ? 'Light' : need.verdict === 'strong' ? 'Well covered' : 'Alright'}
                  </Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        </Panel>
      </details>

      <Section
        title="Get the word out"
        action={
          <div className="row row--wrap">
            <Button variant="primary" onClick={() => gameActions().askForRecommendations()} disabled={alreadyAsked}>
              {alreadyAsked ? 'Asked today' : 'Ask the lads for names'}
            </Button>
            <Button variant="ghost" onClick={() => gameActions().checkFiveASide()} disabled={alreadyWatched}>
              {alreadyWatched ? 'Been today' : 'Look in at five-a-side'}
            </Button>
            <Button variant="ghost" onClick={() => gameActions().holdOpenSession()} disabled={sessionThisWeek}>
              {sessionThisWeek ? 'Session already today' : 'Put on an open session (£20–£40)'}
            </Button>
            {awaitingSession > 0 && (
              <Button variant="primary" onClick={() => gameActions().runTrialSession()}>
                Run the session ({awaitingSession} expected)
              </Button>
            )}
          </div>
        }
      >
        <p className="small muted">
          Five-a-side at <strong>{fiveASideVenueFor(game, club.townId).name}</strong>. An open session costs £20–£40.
        </p>
      </Section>

      <Section
        title={`Discovered — ${open.length} on the list`}
      >
        {open.length === 0 && (
          <p className="empty">
            Nobody yet. Ask the lads, get down to five-a-side, or put a session on and see who turns up.
          </p>
        )}
        <TileGrid min={250}>
          {open.map((candidate) => (
            <CandidateRow key={candidate.personId} state={game} candidate={candidate} />
          ))}
        </TileGrid>

        {closed.length > 0 && (
          <details className="more" style={{ marginTop: 'var(--s3)' }}>
            <summary className="small muted">Off the list ({closed.length})</summary>
            <ul className="tight-list">
              {closed.map((candidate) => (
                <li key={candidate.personId}>
                  <div className="row row--wrap">
                    {/* The men the club decided against are still men, and this
                        list is the only place a manager ever sees them again: the
                        open candidates above are drawn, and a face here is what
                        makes it a list of people rather than a list of decisions.
                        */}
                    <PersonLine personId={candidate.personId}>
                      <strong>{personName(game, candidate.personId)}</strong>
                    </PersonLine>
                    <Pill tone={candidate.status === 'joined' ? 'ok' : 'muted'}>
                      {CANDIDATE_STATUS_LABEL[candidate.status]}
                    </Pill>
                    <span className="muted small">{personHint(game, candidate.personId)}</span>
                  </div>
                  {candidate.outcome && <div className="muted small">{candidate.outcome}</div>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>
    </div>
  );
}

function personName(state: GameState, personId: PersonId): string {
  const person = state.people[personId];
  return person ? personDisplayName(person) : 'Somebody';
}

function personHint(state: GameState, personId: PersonId): string {
  const person = state.people[personId];
  if (!person || !isPlayer(person)) return '';
  const club = person.clubId ? state.clubs[person.clubId]?.identity.shortName : null;
  return `${person.age} · ${person.preferredPosition} · ${club ?? 'not playing anywhere'}`;
}

function knowledgeCounts(knowledge: CandidateKnowledge): { known: number; reported: number; total: number } {
  const entries = Object.values(knowledge.attributes);
  return {
    known: entries.filter((entry) => entry.confidence === 'known').length,
    reported: entries.filter((entry) => entry.confidence === 'reported').length,
    total: entries.length,
  };
}

/**
 * A name on the list. Clicking it opens the conversation, which is where his
 * profile, what the manager knows and what he could do about it all live.
 */
function CandidateRow({
  state,
  candidate,
}: {
  state: GameState;
  candidate: RecruitmentCandidate;
}) {
  const counts = knowledgeCounts(candidate.knowledge);
  const sourceName = candidate.sourcePersonId ? personName(state, candidate.sourcePersonId) : null;
  // The candidate's own record, so the row can be marked like every other row of
  // a person in the game rather than carrying a second, hand-rolled mark.
  const person = state.people[candidate.personId];

  return (
    <Tile
      label={
        <span className="news-tile__meta">
          <span className={`chip ${candidate.status === 'invited' || candidate.status === 'trialled' ? 'chip--accent' : ''}`}>
            {CANDIDATE_STATUS_LABEL[candidate.status]}
          </span>
        </span>
      }
      onClick={() => gameActions().openNegotiation(candidate.personId)}
      title={`Talk terms with ${personName(state, candidate.personId)}`}
    >
      {/* The face beside the name rather than above it, which is how every other
          list of people in the game draws a man — and on a tile two thirds empty
          the stacked version left him floating on a line of his own with a gap
          under it. */}
      <span className="player-tile__head">
        {person && <Portrait person={person} />}
        <span className="player-tile__top">
          <span className="player-tile__name">{personName(state, candidate.personId)}</span>
          <span className="player-tile__position">{personHint(state, candidate.personId)}</span>
        </span>
      </span>
      <span className="muted small">
        {DISCOVERY_SOURCE_LABEL[candidate.discoveredVia]}
        {sourceName ? ` · ${sourceName}` : ''}
      </span>
      <span className="player-tile__secondary">{counts.total === 0 ? 'Nothing known yet' : `${counts.known} attributes seen · ${counts.reported} reported`} · Open to evaluate and talk</span>
    </Tile>
  );
}
