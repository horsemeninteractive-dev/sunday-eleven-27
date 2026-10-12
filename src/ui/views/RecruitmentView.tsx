import type { GameState } from '@/domain/game';
import type { PersonId } from '@/domain/ids';
import { isPlayer, personDisplayName } from '@/domain/person';
import { POSITION_GROUP_LABEL, POSITIONS } from '@/domain/positions';
import {
  CANDIDATE_STATUS_LABEL,
  DISCOVERY_SOURCE_LABEL,
  type CandidateKnowledge,
  type RecruitmentCandidate,
  type SquadNeed,
} from '@/domain/recruitment';
import { OPEN_SESSION_COST, fiveASideVenueFor } from '@/simulation/recruitment/discovery';
import { squadAssessment, type SigningPriority } from '@/simulation/recruitment/needs';
import { candidatesOf, recruitmentStore } from '@/simulation/recruitment/store';
import { gameActions, useGame } from '../hooks';
import { moneyRange } from '../format';
import { Button, Meter, PageHeader, Panel, Pill, SortTh } from '../components/primitives';
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
  // One reading of the squad, used three times: the priorities at the top of the
  // screen, the four counts under them, and the line in the page head. Reading it
  // twice would let two parts of the same screen disagree about the same squad.
  const assessment = squadAssessment(game, club.id);
  const needs = assessment.needs;
  const shortfalls = priorityRows(assessment.priorities);
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
  // Which of the doors on the screen is the next one, so exactly one of them is
  // painted as the thing to press. See `nextRecruitmentStep`.
  const nextStep = nextRecruitmentStep({
    asked: alreadyAsked,
    watched: alreadyWatched,
    sessionPutOn: sessionThisWeek,
    awaitingSession,
  });

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Club"
        title="Recruitment"
        photo="/photos/recruitment-trial.webp"
        subtitle="Find names through the local game, watch them, then talk terms."
        meta={
          <>
            <span className="small muted">{open.length} on the list</span>
            {awaitingSession > 0 && <span className="small muted">{awaitingSession} waiting on a session</span>}
            {/* The biggest shortfall in the club's own football, in the head of
                the screen rather than only in the list below it: it is the one
                sentence a manager needs before he does anything about it. */}
            {shortfalls.length > 0 && <span className="small muted">{shortfalls[0]!.reason}</span>}
            {shortfalls.length === 0 && needs.summary.length > 0 && (
              <span className="small muted">{needs.summary[0]}</span>
            )}
          </>
        }
      />

      {/* What to do before what there is. A manager opens this screen to find out
          where the squad is short, and "short of players who can do the job the
          system asks of them" is an answer he can act on, where "6 registered"
          is only a number. The counts follow it, and the reasons never promise
          a signing: a name still has to want to come, which is the rest of the
          screen. */}
      <Section
        title="What the squad is short of"
        action={<span className="small muted">Read from the shape you play</span>}
      >
        {shortfalls.length === 0 ? (
          <p className="empty">
            Nothing stands out: the squad covers the jobs your system asks of it. An injury or a
            departure can change that in a week.
          </p>
        ) : (
          <TileGrid min={260}>
            {shortfalls.map((row) => (
              // The same tile the four counts below are drawn in, because it is
              // the same kind of thing: an area of the squad, the position that
              // hurts most in it, and the reading behind it.
              <MetricTile
                key={row.key}
                label={row.area}
                value={row.position}
                note={row.reason}
                tone={row.tone}
              />
            ))}
          </TileGrid>
        )}
        <p className="muted small" style={{ marginTop: 'var(--s2)' }}>
          What the club's football asks for, not a transfer list — the men to fill it are found the
          slow way, and any name this screen turns up still has to want to come.
        </p>
      </Section>

      <Section title="Squad needs">
        <TileGrid min={160}>
          {needs.positions.map((need) => {
            const tone = needVerdictTone(need.verdict);
            // The verdict in colour, with the squad-need's own sentence behind
            // it — the sentence the simulation already writes for exactly this
            // card and which nothing on the screen had room for.
            const badge = (
              <span className={`need-badge need-badge--${tone}`} title={need.note}>
                {needVerdictLabel(need.verdict)}
              </span>
            );
            return (
              <MetricTile
                key={need.group}
                label={need.label}
                value={`${need.available}/${need.registered}`}
                tone={tone}
                note={badge}
              >
                {/* Depth behind the number: how much of this part of the squad
                    is actually available this week. The four cards are drawn
                    the same way, which is what lets them be read along. */}
                <span
                  className="need-gauge"
                  role="img"
                  aria-label={`${need.available} of ${need.registered} available this week`}
                >
                  <Meter value={need.available} max={Math.max(1, need.registered)} tone={tone} />
                </span>
              </MetricTile>
            );
          })}
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
                    {needVerdictLabel(need.verdict)}
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
            <Button variant={nextStep === 'ask' ? 'primary' : 'ghost'} onClick={() => gameActions().askForRecommendations()} disabled={alreadyAsked}>
              {alreadyAsked ? 'Asked today' : 'Ask the lads for names'}
            </Button>
            <Button variant={nextStep === 'five-a-side' ? 'primary' : 'ghost'} onClick={() => gameActions().checkFiveASide()} disabled={alreadyWatched}>
              {alreadyWatched ? 'Been today' : 'Look in at five-a-side'}
            </Button>
            <Button variant={nextStep === 'open-session' ? 'primary' : 'ghost'} onClick={() => gameActions().holdOpenSession()} disabled={sessionThisWeek}>
              {sessionThisWeek ? 'Session already today' : `Put on an open session (${moneyRange(OPEN_SESSION_COST)})`}
            </Button>
            {awaitingSession > 0 && (
              <Button variant={nextStep === 'trial' ? 'primary' : 'ghost'} onClick={() => gameActions().runTrialSession()}>
                Run the session ({awaitingSession} expected)
              </Button>
            )}
          </div>
        }
      >
        <p className="small muted">
          Five-a-side at <strong>{fiveASideVenueFor(game, club.townId).name}</strong>. An open session costs{' '}
          {moneyRange(OPEN_SESSION_COST)}.
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

/**
 * What a verdict is called, and what colour it is.
 *
 * One place, because the card and the breakdown table under it are the same
 * four numbers and must not describe them two different ways — and because the
 * tile's tone, the badge and the bar are all the verdict, so they are all
 * derived from it rather than each deciding for itself.
 */
function needVerdictLabel(verdict: SquadNeed['verdict']): string {
  return verdict === 'thin' ? 'Light' : verdict === 'strong' ? 'Well covered' : 'Alright';
}

/**
 * A shortfall, as the screen draws it.
 *
 * The simulation decides *what* is needed and says so in its own sentence
 * (`squadAssessment`); this only decides the order, the heading over each row and
 * the colour. It is separate from the component so it can be tested without a
 * browser, and so the screen and its own test cannot disagree about which
 * shortfall is the serious one.
 */
export interface PriorityRow {
  key: string;
  area: string;
  position: string;
  reason: string;
  tone: 'warn' | 'default' | 'muted';
}

/**
 * The shortfalls, most urgent first, one row per area of the squad.
 *
 * The engine already orders them and keeps at most one per area; both rules are
 * applied again here rather than assumed, because a screen that reorders or
 * duplicates them would be telling the manager something the simulation did not.
 * The reason is carried through word for word — it is the simulation's own
 * sentence about the squad, and paraphrasing it here would be a second opinion.
 */
export function priorityRows(priorities: readonly SigningPriority[]): PriorityRow[] {
  const seen = new Set<string>();
  const rows: PriorityRow[] = [];
  for (const priority of [...priorities].sort((a, b) => b.weight - a.weight || a.position.localeCompare(b.position))) {
    if (seen.has(priority.group)) continue;
    seen.add(priority.group);
    rows.push({
      key: priority.group,
      area: POSITION_GROUP_LABEL[priority.group],
      position: POSITIONS[priority.position].label,
      reason: priority.reason,
      tone: priority.weight >= 0.6 ? 'warn' : priority.weight >= 0.35 ? 'default' : 'muted',
    });
  }
  return rows;
}

export type RecruitmentStep = 'ask' | 'five-a-side' | 'open-session' | 'trial';

/**
 * The next thing to do about the squad's numbers, or nothing at all.
 *
 * Three buttons carrying the same weight is not guidance: the row offers three
 * doors whether or not one of them has already been walked through today, and a
 * new manager has no way of knowing which of them the screen would press for
 * him. This is the order the club would actually work in — the men in the
 * dressing room first because they are free, then the five-a-side everyone in
 * the town plays on, then the afternoon and the money an open session costs —
 * and a session with men already waiting on it leads everything, because that
 * is a player who came down and is owed a game.
 *
 * `null` when the day's routes are all spent, which is honest: the screen then
 * paints nothing as the next step, because there is not one.
 */
export function nextRecruitmentStep(input: {
  asked: boolean;
  watched: boolean;
  sessionPutOn: boolean;
  awaitingSession: number;
}): RecruitmentStep | null {
  if (input.awaitingSession > 0) return 'trial';
  if (!input.asked) return 'ask';
  if (!input.watched) return 'five-a-side';
  if (!input.sessionPutOn) return 'open-session';
  return null;
}

function needVerdictTone(verdict: SquadNeed['verdict']): 'ok' | 'warn' | 'default' {
  return verdict === 'thin' ? 'warn' : verdict === 'strong' ? 'ok' : 'default';
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
