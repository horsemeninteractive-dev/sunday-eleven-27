import { personDisplayName, isPlayer } from '@/domain/person';
import {
  CANDIDATE_STATUS_LABEL,
  DISCOVERY_SOURCE_LABEL,
  KNOWLEDGE_CONFIDENCE_LABEL,
  knowledgeLines,
} from '@/domain/recruitment';
import { POSITIONS } from '@/domain/positions';
import { formatShortDate } from '@/simulation/calendar';
import { estimateAbilityBand, suitabilityFor } from '@/simulation/queries';
import { candidateInterest } from '@/simulation/recruitment/interest';
import { joiningProspect } from '@/simulation/recruitment/signing';
import { candidateOf } from '@/simulation/recruitment/store';
import { useGame, gameActions } from '../hooks';
import { Button, Panel, Pill } from './primitives';
import { ClubLink, PlayerLink } from './Links';

/**
 * Talking terms.
 *
 * Football Manager's transfer conversation, adapted to a Sunday League where
 * nobody is on a contract: what the manager is really doing here is deciding
 * whether to put *the question* to somebody. So the dialog is honest about what
 * the game actually models — no invented wage negotiation — and shows the
 * reasons he might say yes or no, in his own words, alongside what the manager
 * has heard about him.
 */
export function NegotiationModal({ personId }: { personId: string }) {
  const game = useGame();
  if (!game) return null;
  const person = game.people[personId];
  const club = game.clubs[game.userClubId]!;
  const record = candidateOf(game, personId);

  if (!person || !isPlayer(person) || !record) {
    return (
      <div className="overlay" role="dialog" aria-modal="true" aria-label="Talk terms">
        <div className="overlay__panel overlay__panel--narrow">
          <div className="overlay__bar">
            <span className="overlay__title">Talk terms</span>
            <button type="button" className="overlay__close" aria-label="Close" onClick={() => gameActions().closeNegotiation()}>
              ✕
            </button>
          </div>
          <div className="overlay__body">
            <p className="empty">
              There is no conversation to have here. Recruitment in this game starts with somebody putting a name to
              you — through the squad, five-a-side, or an open session.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const assessment = candidateInterest(game, personId, club.id);
  const knowledge = knowledgeLines(record.knowledge);
  const currentClub = person.clubId ? game.clubs[person.clubId] : undefined;
  const settled = record.status === 'joined';
  const transcript = record.history.slice(-8);
  const latestQuote = record.interestHints[record.interestHints.length - 1];

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={`Talk terms with ${personDisplayName(person)}`}>
      <div className="overlay__panel overlay__panel--narrow">
        <div className="overlay__bar">
          <span className="overlay__title">
            Talk terms — {person.firstName} {person.surname}
          </span>
          <div className="row row--tight">
            <Pill tone="muted">{CANDIDATE_STATUS_LABEL[record.status]}</Pill>
            <button type="button" className="overlay__close" aria-label="Close" onClick={() => gameActions().closeNegotiation()}>
              ✕
            </button>
          </div>
        </div>

        <div className="negotiation">
          <div className="negotiation__say">
            {transcript.length === 0 && (
              <div className="bubble bubble--them">
                <span className="bubble__from">You</span>
                Nothing has been said yet. Whatever you do here will be remembered.
              </div>
            )}
            {transcript.map((entry, index) => {
              const mine = /^You\b/.test(entry.description);
              const line = entry.description.replace(/^You\s+/, '');
              return (
                <div className={`bubble ${mine ? 'bubble--you' : 'bubble--them'}`} key={`${entry.date}-${index}`}>
                  <span className="bubble__from">
                    {mine ? 'You say' : `${person.firstName} ${person.surname}`} · {formatShortDate(entry.date)}
                  </span>
                  {mine ? `${line.charAt(0).toUpperCase()}${line.slice(1)}` : entry.description}
                </div>
              );
            })}
            {latestQuote && <p className="muted small">Last time you spoke: “{latestQuote}”</p>}

            <Panel title="What do you want to do?" level="primary">
              {settled ? (
                <p className="small">
                  He is already registered with you. There is nothing left to agree — Sunday League registration is the
                  whole deal.
                </p>
              ) : (
                <div className="profile-actions">
                  <Button
                    variant="primary"
                    block
                    onClick={() => gameActions().offerToJoin(personId)}
                    title="Register him with the club"
                  >
                    Offer him a place
                  </Button>
                  <Button variant="default" block onClick={() => gameActions().approachCandidate(personId)}>
                    Ask him whether he fancies it
                  </Button>
                  <Button variant="ghost" block onClick={() => gameActions().inviteToTrial(personId)}>
                    Invite him down to a session
                  </Button>
                  <Button variant="danger" block onClick={() => gameActions().passOnCandidate(personId)}>
                    Not for us
                  </Button>
                </div>
              )}
              <p className="muted small">
                {settled
                  ? 'Nothing here changes what he does on a Sunday.'
                  : 'Every one of these is something he will hear about. Asking a settled player often does not stay quiet.'}
              </p>
            </Panel>
          </div>

          <div className="negotiation__side stack">
            <Panel title="Profile" level="default">
              <div className="facts">
                <div className="facts__row">
                  <dt>Player</dt>
                  <dd>
                    <PlayerLink personId={personId}>
                      {person.firstName} {person.surname}
                    </PlayerLink>
                  </dd>
                </div>
                <div className="facts__row">
                  <dt>Current club</dt>
                  <dd>{currentClub ? <ClubLink clubId={currentClub.id} /> : <span className="muted">Not registered</span>}</dd>
                </div>
                <div className="facts__row">
                  <dt>Plays</dt>
                  <dd>
                    {person.preferredPosition} · <span className="muted small">{POSITIONS[person.preferredPosition].label}</span>
                  </dd>
                </div>
                <div className="facts__row">
                  <dt>Age</dt>
                  <dd>{person.age}</dd>
                </div>
                <div className="facts__row">
                  <dt>Impression</dt>
                  <dd>{estimateAbilityBand(person)}</dd>
                </div>
                <div className="facts__row">
                  <dt>Day job</dt>
                  <dd>{person.occupation}</dd>
                </div>
              </div>
              <p className="muted small">
                Fits your shape at {suitabilityFor(person, person.preferredPosition)}/100 in his own position.
              </p>
            </Panel>

            <Panel title="Approach" level="default" subtitle={DISCOVERY_SOURCE_LABEL[record.discoveredVia]}>
              <p className="small">{record.sourceNote}</p>
              <div className="facts">
                <div className="facts__row">
                  <dt>On the list since</dt>
                  <dd>{formatShortDate(record.discoveredOn)}</dd>
                </div>
                <div className="facts__row">
                  <dt>Sessions with you</dt>
                  <dd>{record.trials}</dd>
                </div>
                <div className="facts__row">
                  <dt>Status</dt>
                  <dd>{CANDIDATE_STATUS_LABEL[record.status]}</dd>
                </div>
              </div>
              <p className="small">
                <strong>{joiningProspect(game, personId)}</strong>
              </p>
            </Panel>

            <Panel title="How likely is a yes?" level="quiet" subtitle="The reasons, in his words">
              {assessment.reasons.length === 0 && <p className="muted small">Nothing is known about his situation.</p>}
              <ul className="tight-list">
                {assessment.reasons.map((reason, index) => (
                  <li key={`${reason.text}-${index}`}>
                    <div className="row row--wrap">
                      <Pill tone={reason.weight >= 0 ? 'ok' : 'bad'}>{reason.weight >= 0 ? 'for' : 'against'}</Pill>
                      <span className="small">{reason.text}</span>
                    </div>
                    <div className="muted small">“{reason.quote}”</div>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="What you know" level="quiet" subtitle="Second hand, unless it says otherwise">
              {knowledge.length === 0 && <p className="muted small">Nothing much yet. Watch him, or get him down.</p>}
              <ul className="tight-list">
                {knowledge.slice(0, 8).map((line) => (
                  <li key={line.key}>
                    <div className="row row--wrap">
                      <strong>{line.label}</strong>
                      <Pill tone="accent">{line.band}</Pill>
                      <span className="muted small">{KNOWLEDGE_CONFIDENCE_LABEL[line.confidence].toLowerCase()}</span>
                    </div>
                    <div className="muted small">{line.source}</div>
                  </li>
                ))}
              </ul>
              {record.knowledge.notes.length > 0 && (
                <ul className="bullets">
                  {record.knowledge.notes.slice(-4).map((note, index) => (
                    <li key={`${note}-${index}`}>{note}</li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>

        <div className="negotiation__bar">
          {settled ? (
            <Button variant="ghost" onClick={() => gameActions().closeNegotiation()}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => gameActions().closeNegotiation()}>
                Leave it for now
              </Button>
              <Button variant="primary" onClick={() => gameActions().offerToJoin(personId)}>
                Offer him a place
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
