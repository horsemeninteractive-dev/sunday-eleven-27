import { useMemo } from 'react';
import type { GameState } from '@/domain/game';
import type { ClubId } from '@/domain/ids';
import { PRESS_FOCUS_LABEL, PUBLICATION_KIND_LABEL, RUMOUR_STATUS_LABEL, RUMOUR_SUBJECT_LABEL } from '@/domain/press';
import { formatShortDate } from '@/simulation/calendar';
import { pressForClub } from '@/simulation/press';
import { SUPPORTER_MOOD_LABEL, supporterMood } from '@/simulation/support';
import { gameActions, useGame } from '../hooks';
import { Button, Fact, Panel, Pill } from './primitives';
import { Section } from './hierarchy';

/**
 * Who writes about this club.
 *
 * A Sunday club is covered by one reporter on one paper, and he is a person the
 * manager has to deal with: he decides what the town reads about Sunday, he
 * remembers what he was told, and he is wrong about things in public. This panel
 * is that relationship, on the screen where the club's own people already are —
 * the committee, the sponsor, the ground — because the man from the paper is one
 * of the people who run the club's week.
 *
 * Three things it refuses to do:
 *
 *   - **it never prints a claim as a fact.** A live rumour is labelled
 *     unconfirmed, given the odds the reporter himself would put on it, and set
 *     apart from what the club knows; a settled one says how it turned out;
 *   - **it never invents a number into a sentence.** The crowd's mood and the
 *     reporter's own view of the manager are read from the systems that keep
 *     them (`support.ts`, `press.ts`) and said the way a person would say them,
 *     with the figure behind them for anyone who wants it;
 *   - **it offers the one action that means anything.** Playing a claim down or
 *     giving the reporter something is the only thing a manager can do about a
 *     story, and both of those change how he writes next — so both are here, and
 *     nothing else is.
 *
 * Everything shown comes from `pressForClub`, which is the same reader the news
 * screen's bylines are written from. The panel cannot disagree with the paper.
 *
 * It is two functions on purpose, the way the home screen's pieces are: `PressPanel`
 * is the door — it reads the store and answers a button — and `PressPanelBody`
 * draws what it is given and calls whoever opens it. A layout that reads nothing
 * but its own props is one that can be printed and read in a test without a
 * browser, which is the only way most of this copy is ever checked.
 */
export function PressPanel({ clubId }: { clubId: ClubId }) {
  const game = useGame();
  const view = useMemo(() => (game ? pressForClub(game, clubId) : null), [game, clubId]);
  if (!game || !view) return null;
  return (
    <PressPanelBody
      game={game}
      clubId={clubId}
      onRespond={(rumourId, kind) => gameActions().respondToRumour(rumourId, kind)}
    />
  );
}

export type PressResponse = 'declined' | 'acknowledged';

export function PressPanelBody({
  game,
  clubId,
  onRespond,
}: {
  game: GameState;
  clubId: ClubId;
  onRespond: (rumourId: string, kind: PressResponse) => void;
}) {
  const view = pressForClub(game, clubId);
  if (!view) return null;

  const { publication, journalist, live, settled, regard, confidence } = view;
  const statements = game.press?.statements ?? [];
  const answerFor = (rumourId: string) => statements.find((statement) => statement.rumourId === rumourId) ?? null;
  const reporter = `${journalist.firstName} ${journalist.surname}`;
  const mood = supporterMood(confidence);
  const patch = journalist.beats.filter((id) => id !== clubId);

  return (
    <Section
      title="The local paper"
      id="press"
      action={<span className="small muted">{PUBLICATION_KIND_LABEL[publication.kind]}</span>}
    >
      <Panel
        title={publication.name}
        subtitle={[
          PUBLICATION_KIND_LABEL[publication.kind],
          game.world.towns[publication.townId]?.name ?? null,
          `Printing since ${publication.founded}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      >
        <p className="small muted">{publication.strapline}</p>
        <p>
          <strong>{reporter}</strong> covers this club.{' '}
          <span className="muted">{PRESS_FOCUS_LABEL[journalist.focus]}.</span>
        </p>
        <dl className="facts facts--inline">
          <Fact
            label="His patch"
            value={
              patch.length === 0
                ? 'This club only'
                : `${journalist.beats.length} clubs, including ${patch
                    .slice(0, 2)
                    .map((id) => game.clubs[id]?.identity.shortName ?? 'one other')
                    .join(' and ')}`
            }
          />
          <Fact label="Stories filed" value={journalist.filings} />
          <Fact label="Last wrote" value={journalist.lastFiledOn ? formatShortDate(journalist.lastFiledOn) : 'Nothing yet'} />
          <Fact label="The crowd" value={`${SUPPORTER_MOOD_LABEL[mood]} · ${Math.round(confidence)}/100`} />
        </dl>
        <p className="small muted">{regardWords(regard)}</p>
      </Panel>

      {live.length > 0 && (
        <Panel
          title="What he is saying"
          level="primary"
          subtitle="He has heard it, and that is all anybody knows yet."
        >
          <ul className="tight-list">
            {live.map((claim) => {
              const answer = answerFor(claim.id);
              return (
                <li key={claim.id}>
                  <div className="row row--wrap row--tight">
                    <strong>{RUMOUR_SUBJECT_LABEL[claim.subject]}</strong>
                    <Pill tone="warn">Unconfirmed</Pill>
                    <span className="small muted">
                      Worth believing: about {Math.round(claim.reliability * 100)}% · answered by{' '}
                      {formatShortDate(claim.resolvesOn)}
                    </span>
                  </div>
                  <p className="press-claim__claim">{claim.claim}</p>
                  {answer ? (
                    <p className="small muted">
                      {answer.kind === 'declined'
                        ? 'You have played it down. He has written that down.'
                        : 'You have given him something on the record.'}
                    </p>
                  ) : (
                    <div className="row row--wrap row--tight">
                      <Button size="sm" variant="ghost" onClick={() => onRespond(claim.id, 'declined')}>
                        Play it down
                      </Button>
                      <Button size="sm" variant="default" onClick={() => onRespond(claim.id, 'acknowledged')}>
                        Give them something
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="small muted">
            What you say does not settle it. The season does, and he will write that too.
          </p>
        </Panel>
      )}

      {settled.length > 0 ? (
        <details className="more">
          <summary>How the last few turned out</summary>
          <ul className="tight-list">
            {settled.map((claim) => (
              <li key={claim.id}>
                <div className="row row--wrap row--tight">
                  <strong>{RUMOUR_SUBJECT_LABEL[claim.subject]}</strong>
                  <Pill tone={claim.status === 'confirmed' ? 'warn' : 'muted'}>{RUMOUR_STATUS_LABEL[claim.status]}</Pill>
                  <span className="small muted">{formatShortDate(claim.settledOn ?? claim.resolvesOn)}</span>
                </div>
                <p className="small muted">{claim.claim}</p>
                {claim.outcome && <p className="small">{claim.outcome}</p>}
              </li>
            ))}
          </ul>
        </details>
      ) : (
        live.length === 0 && (
          <p className="small muted">
            Nothing about this club has been written down and not answered. That is how {reporter} likes it and how
            nobody else does.
          </p>
        )
      )}
    </Section>
  );
}

/**
 * What the reporter thinks of the manager, in words.
 *
 * The number behind it is his regard, which is 0-100 around a civil 50 — but a
 * manager does not want a number about a man, he wants to know whether the next
 * story will be written kindly. The bands are his own behaviour rather than a
 * mood: whether he rings first, whether he asks for a comment, whether he
 * writes about the club at all.
 */
function regardWords(regard: number): string {
  if (regard >= 75) return 'He rings you first and prints what you say.';
  if (regard >= 60) return 'He is well disposed towards you, and it shows in what he writes.';
  if (regard >= 40) return 'Civil. He asks for a comment and uses it.';
  if (regard >= 25) return 'He has started watching this club more closely than he used to.';
  return 'You have left him with something to prove, and he has not forgotten it.';
}
