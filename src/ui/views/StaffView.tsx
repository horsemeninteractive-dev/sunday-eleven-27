import { isOfficial, isPlayer, personDisplayName } from '@/domain/person';
import { competenceLabel, STAFF_ROLE_LABEL, STAFF_ROLE_ORDER, type StaffRole } from '@/domain/staff';
import { userClub } from '@/simulation/queries';
import { visibleRelationshipViewsFor } from '@/simulation/relationships';
import { staffCompetence, staffIsAvailable, staffMembers } from '@/simulation/staff';
import { assistantAdvice, physioReport } from '@/simulation/staffOps';
import { financialResponsibility } from '@/simulation/treasurer';
import { secretarySummary } from '@/simulation/secretary';
import { governanceSummary } from '@/simulation/governance';
import { GOVERNANCE_STANDING_LABEL, governanceStandingRank } from '@/domain/governance';
import { formatShortDate } from '@/simulation/calendar';
import { clubRoster } from '../clubMatters';
import { gameActions, useGame } from '../hooks';
import { Button, Callout, PageHeader, Pill } from '../components/primitives';
import { MetricTile, Section, TileGrid } from '../components/hierarchy';

/**
 * Staff.
 *
 * The club's committee, off the pitch: who runs the team with you, who keeps the
 * books, who straps the ankles and who puts the nets up. The screen answers the
 * questions a manager actually has — is there a physio, who is he, and is he any
 * good — rather than laying the whole person record out.
 *
 * It is deliberately short. A Sunday club has three or four people on it, not a
 * backroom of thirty, and most weeks there is nothing to do here but know who is
 * around when something needs doing.
 */
export function StaffView() {
  const game = useGame();
  if (!game) return null;

  const club = userClub(game);
  const members = staffMembers(club);
  const managerId = club.managerId;
  const relationships = managerId
    ? new Map(visibleRelationshipViewsFor(game, managerId).map((view) => [view.otherId, view]))
    : new Map();

  const coaches = members.filter((member) => member.role === 'coach').length;
  const covered = new Set(members.map((member) => member.role));
  const missing = STAFF_ROLE_ORDER.filter(
    (role) => role !== 'chairman' && !covered.has(role),
  ) as StaffRole[];
  const advice = assistantAdvice(game);
  const physio = physioReport(game);
  const book = financialResponsibility(game);
  const desk = secretarySummary(game);
  const board = governanceSummary(game);
  // What each office is currently carrying, from the one place that works it
  // out — the same list the Club screen draws, so the two screens cannot tell
  // the manager two different things about the same man.
  const issues = new Map(clubRoster(game, club.id).map((person) => [person.personId, person.issue]));

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Club admin"
        title="Staff"
        subtitle={`${members.length} on the committee at ${club.identity.name}`}
        actions={
          <Button variant="ghost" onClick={() => gameActions().setView('finances')}>
            The treasurer's book
          </Button>
        }
      />

      <TileGrid min={175}>
        <MetricTile label="Committee" value={members.length} note="Including you and the chairman" />
        <MetricTile label="Coaches" value={coaches} note={coaches > 0 ? 'Training ground' : 'Nobody takes sessions'} />
        <MetricTile
          label="Roles covered"
          value={`${covered.size}/${STAFF_ROLE_ORDER.length}`}
          note="A small club never fills them all"
        />
      </TileGrid>

      <Section title="The committee" id="committee">
        {members.length === 0 && (
          <p className="empty">Nobody is on the committee yet. You are running this club on your own.</p>
        )}
        <ul className="tight-list">
          {members.map((member) => {
            const person = game.people[member.personId];
            const official = isOfficial(person) ? person : null;
            const player = isPlayer(person) ? person : null;
            const available = official ? staffIsAvailable(official) : null;
            const competence = official ? staffCompetence(official, member.role) : null;
            const relationship = relationships.get(member.personId);
            const duty = person ? person.notes[person.notes.length - 1] : null;
            return (
              <li key={`${member.role}-${member.personId}`}>
                <div className="row row--wrap">
                  <Pill tone="accent">{STAFF_ROLE_LABEL[member.role]}</Pill>
                  {person ? (
                    player ? (
                      <>
                        <strong>{personDisplayName(player)}</strong>
                        <Pill tone="muted">also a player</Pill>
                      </>
                    ) : (
                      <strong>{personDisplayName(official!)}</strong>
                    )
                  ) : (
                    <strong className="muted">vacant</strong>
                  )}
                  {available !== null && (
                    <Pill tone={available ? 'ok' : 'warn'}>{available ? 'Around' : 'Unavailable'}</Pill>
                  )}
                  {competence !== null && <Pill tone="muted">{competenceLabel(competence)}</Pill>}
                  {relationship && <span className="muted small">{relationship.summary.label}</span>}
                  {person && member.personId !== club.managerId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      // Every row's button says "Message", so the name has to go
                      // on the accessible label: five identical buttons is a
                      // menu with no items as far as a screen reader is concerned.
                      ariaLabel={`Message ${personDisplayName(person)}`}
                      onClick={() => gameActions().startConversationWith(member.personId)}
                    >
                      Message
                    </Button>
                  )}
                </div>
                <div className="muted small">
                  {official ? `Age ${official.age} · ${official.occupation}` : 'Doubles up on the pitch'}
                  {duty ? ` · ${duty}` : ''}
                </div>
                {/* Only where there is one: the single thing this office is
                    carrying right now, or the fact that they are away. */}
                {issues.get(member.personId) && (
                  <div className="small tone tone--warn">{issues.get(member.personId)}</div>
                )}
              </li>
            );
          }        )}
        </ul>
        <p className="small">
          {book.role === 'none'
            ? 'Nobody keeps the books — the money is on your desk for now.'
            : book.role === 'treasurer'
              ? `Treasurer: ${book.name}${book.managerToo ? ' (also the manager)' : ''}.`
              : `No treasurer, so ${book.name} keeps the books as manager.`}
        </p>
      </Section>

      {board.chairman && (
        <Section title="The chairman" id="chairman">
          <div className="row row--wrap">
            <strong>{board.chairmanName}</strong>
            <Pill
              tone={
                governanceStandingRank(board.standing) >= governanceStandingRank('pressure')
                  ? 'bad'
                  : board.standing === 'warning'
                    ? 'warn'
                    : governanceStandingRank(board.standing) <= governanceStandingRank('content')
                      ? 'ok'
                      : 'muted'
              }
            >
              {GOVERNANCE_STANDING_LABEL[board.standing]}
            </Pill>
            {board.relationship && <span className="muted small">{board.relationship}</span>}
          </div>
          <p className="muted small">What the committee expects, and how it is going.</p>
          <ul className="tight-list">
            {board.expectations.map((expectation) => (
              <li key={expectation.key}>
                <div className="row row--wrap">
                  <Pill
                    tone={
                      expectation.status === 'met'
                        ? 'ok'
                        : expectation.status === 'failed'
                          ? 'bad'
                          : expectation.status === 'at-risk'
                            ? 'warn'
                            : 'muted'
                    }
                  >
                    {expectation.status === 'met'
                      ? 'On track'
                      : expectation.status === 'at-risk'
                        ? 'At risk'
                        : expectation.status === 'failed'
                          ? 'Falling short'
                          : 'Too early'}
                  </Pill>
                  <strong>{expectation.label}</strong>
                  <span className="muted small">{expectation.detail}</span>
                </div>
              </li>
            ))}
          </ul>

          {board.concerns.length > 0 && (
            <>
              <p className="small"><strong>What is worrying him</strong></p>
              <ul className="tight-list">
                {board.concerns.map((concern) => (
                  <li key={concern.key}>
                    <Pill tone={concern.severity >= 3 ? 'bad' : 'warn'}>{concern.kind}</Pill>{' '}
                    <span className="small">{concern.text}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {board.events.length > 0 && (
            <>
              <p className="small"><strong>Matters of record</strong></p>
              <ul className="tight-list">
                {board.events.slice(0, 4).map((event) => (
                  <li key={event.id}>
                    <span className="muted small">{formatShortDate(event.date)}</span>{' '}
                    <strong>{event.title}</strong>
                    <div className="muted small">{event.detail}</div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {club.finances.balance < 0 && (
            <Button size="sm" variant="ghost" onClick={() => gameActions().requestBacking()}>
              Ask the chairman for backing
            </Button>
          )}

          {board.canDismiss && (
            <Callout tone="bad" title="Your position is on the line">
              The committee has the grounds to make a change. Results over the next few weeks are the answer.
            </Callout>
          )}
        </Section>
      )}

      <Section title="The secretary's desk" id="secretary-desk">
        <p className="small">
          {desk.identity.personId
            ? `${desk.identity.name} keeps the club's paperwork`
            : 'No secretary, so the admin lands on your desk'}
          {desk.identity.competence > 0 && ` · ${competenceLabel(desk.identity.competence)}`}
          {desk.identity.personId && !desk.identity.available && ' · away this week'}.
        </p>
        {desk.outstanding.length === 0 ? (
          <p className="empty">Nothing outstanding. The paperwork is up to date.</p>
        ) : (
          <>
            <p className="muted small">
              {desk.needsManager} need{desk.needsManager === 1 ? 's' : ''} you
              {desk.overdue > 0 ? ` · ${desk.overdue} overdue` : ''}
              {desk.filed > 0 ? ` · ${desk.filed} filed by the secretary` : ''}
            </p>
            <ul className="tight-list">
              {desk.outstanding.map((item) => {
                const overdue = item.deadline !== null && item.deadline < game.date;
                return (
                  <li key={item.id}>
                    <div className="row row--wrap">
                      <Pill tone={overdue ? 'bad' : item.actionRequired ? 'warn' : 'muted'}>
                        {overdue ? 'Overdue' : item.actionRequired ? 'Needs you' : 'For information'}
                      </Pill>
                      <strong>{item.title}</strong>
                      {item.deadline && <span className="muted small">by {formatShortDate(item.deadline)}</span>}
                      {item.actionRequired && (
                        <Button size="sm" variant="ghost" onClick={() => gameActions().resolveAdmin(item.id)}>
                          Mark done
                        </Button>
                      )}
                    </div>
                    <div className="muted small">{item.detail}</div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Section>

      {advice.available && (
        <Section title={`What ${advice.assistantName} makes of it`}>
          <ul className="tight-list">
            {advice.lines.map((line, index) => (
              <li key={index}>
                <Pill tone={line.tone}>{line.tone === 'warn' ? 'Watch' : line.tone === 'accent' ? 'Idea' : 'Note'}</Pill>{' '}
                <span className="small">{line.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {!advice.available && advice.assistantName && (
        <Section title="No assistant this week">
          <p className="muted small">
            {advice.assistantName} is not around, so you are on your own with the football.
          </p>
        </Section>
      )}

      {physio.assessments.length > 0 && (
        <Section title={physio.physioName ? `On ${physio.physioName}'s list` : 'The walking wounded'}>
          <ul className="tight-list">
            {physio.assessments.map((row) => (
              <li key={row.personId}>
                <div className="row row--wrap">
                  <strong>{row.name}</strong>
                  <Pill tone="warn">{row.injury}</Pill>
                  <span className="muted small">
                    {row.estimateDays <= 0 ? 'back any day' : `about ${row.estimateDays} day${row.estimateDays === 1 ? '' : 's'}`}
                  </span>
                  <Pill tone="muted">{row.confidence}</Pill>
                </div>
              </li>
            ))}
          </ul>
          <p className="muted small">
            {physio.physioName
              ? 'Your physio’s read — an estimate, not a certainty.'
              : 'No physio at the club, so these are the figures as you see them.'}
          </p>
        </Section>
      )}

      <Section title="Who is not here">
        <p className="small">
          A Sunday club gets by without half of the roles a professional one has. You are doing without:{' '}
          <strong>{missing.length > 0 ? missing.map((role) => STAFF_ROLE_LABEL[role]).join(', ') : 'nothing — the committee is complete'}</strong>.
        </p>
        <p className="muted small">
          Referees are not club staff; they come with the fixture.
        </p>
      </Section>
    </div>
  );
}
