import { useState } from 'react';
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
import { PlayerLink } from '../components/Links';
import { applySort, UNSORTED, type SortAccessors, type SortState } from '../tableSort';

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
  const [sort, setSort] = useState<SortState<NeedSortKey>>(UNSORTED);
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
        subtitle="Names come from people, places and football — the lads, Wednesday five-a-side, an open session, or somebody who asks you first. There is no list of every unattached player in the county."
        meta={
          <>
            <span className="small muted">{open.length} on the list</span>
            {awaitingSession > 0 && <span className="small muted">{awaitingSession} waiting on a session</span>}
            {needs.summary.length > 0 && <span className="small muted">{needs.summary[0]}</span>}
          </>
        }
      />

      <Panel
        title="Where you are short"
        subtitle="Numbers, not recommendations. What you do about it is up to you."
        tone={needs.thinGroups.length > 0 ? 'warn' : 'default'}
      >
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
        {needs.summary.length > 0 && (
          <ul className="bullets">
            {needs.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <p className="muted small">
          {Object.entries(needs.byPosition)
            .sort((a, b) => b[1] - a[1])
            .map(([code, count]) => `${count} ${code}`)
            .join(' · ')}
        </p>
      </Panel>

      <Panel
        level={open.length === 0 ? 'primary' : 'default'}
        title="Get the word out"
        subtitle="Local players are found through people, places and football, not through a list."
        actions={
          <div className="row row--wrap">
            <Button variant="primary" onClick={() => gameActions().askForRecommendations()} disabled={alreadyAsked}>
              {alreadyAsked ? 'Asked this week' : 'Ask the lads for names'}
            </Button>
            <Button variant="ghost" onClick={() => gameActions().checkFiveASide()} disabled={alreadyWatched}>
              {alreadyWatched ? 'Been this week' : 'Look in at five-a-side'}
            </Button>
            <Button variant="ghost" onClick={() => gameActions().holdOpenSession()} disabled={sessionThisWeek}>
              {sessionThisWeek ? 'Session already this week' : 'Put on an open session (£20–£40)'}
            </Button>
            {awaitingSession > 0 && (
              <Button variant="primary" onClick={() => gameActions().runTrialSession()}>
                Run the session ({awaitingSession} expected)
              </Button>
            )}
          </div>
        }
      >
        <p className="small">
          Wednesday five-a-side is at <strong>{fiveASideVenueFor(game, club.townId).name}</strong>. An open session costs
          a bit in pitch hire and brings whoever it brings — usually two or three lads, occasionally somebody who can
          really play.
        </p>
      </Panel>

      <Panel
        level={open.length > 0 ? 'primary' : 'default'}
        title={`Who you have heard about — ${open.length} on the list`}
        subtitle="Click a name to talk terms — his profile, what you know about him, and what you could do next"
      >
        {open.length === 0 && (
          <p className="empty">
            Nobody yet. Ask the lads, get down to five-a-side, or put a session on and see who turns up.
          </p>
        )}
        <ul className="tight-list">
          {open.map((candidate) => (
            <CandidateRow key={candidate.personId} state={game} candidate={candidate} />
          ))}
        </ul>

        {closed.length > 0 && (
          <>
            <h4 className="subhead">Off the list</h4>
            <ul className="tight-list">
              {closed.map((candidate) => (
                <li key={candidate.personId}>
                  <div className="row row--wrap">
                    <PlayerLink personId={candidate.personId}>
                      <strong>{personName(game, candidate.personId)}</strong>
                    </PlayerLink>
                    <Pill tone={candidate.status === 'joined' ? 'ok' : 'muted'}>
                      {CANDIDATE_STATUS_LABEL[candidate.status]}
                    </Pill>
                    <span className="muted small">{personHint(game, candidate.personId)}</span>
                  </div>
                  {candidate.outcome && <div className="muted small">{candidate.outcome}</div>}
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
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

  return (
    <li
      className="rating-row rating-row--clickable"
      onClick={() => gameActions().openNegotiation(candidate.personId)}
      title={`Talk terms with ${personName(state, candidate.personId)}`}
    >
      <span>
        <strong>{personName(state, candidate.personId)}</strong>
        <span className="muted small"> {personHint(state, candidate.personId)}</span>
        <div className="muted small">{candidate.sourceNote}</div>
      </span>
      <Pill tone={candidate.status === 'invited' || candidate.status === 'trialled' ? 'accent' : 'muted'}>
        {CANDIDATE_STATUS_LABEL[candidate.status]}
      </Pill>
      <span className="muted small">
        {DISCOVERY_SOURCE_LABEL[candidate.discoveredVia]}
        {sourceName ? ` · ${sourceName}` : ''}
        <div>{counts.total === 0 ? 'nothing yet' : `${counts.known} seen · ${counts.reported} reported`}</div>
      </span>
    </li>
  );
}
