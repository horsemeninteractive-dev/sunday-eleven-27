import { useMemo, useState } from 'react';
import { GROUND_WORKS, type GroundWorkProject } from '@/domain/facilities';
import type { ClubId } from '@/domain/ids';
import { formatShortDate } from '@/simulation/calendar';
import { groundSummary, type GroundWorkOption } from '@/simulation/grounds';
import { moneyWhole } from '../format';
import { gameActions, useGame } from '../hooks';
import { Button, Callout, Fact, Panel, Pill } from './primitives';
import { Section, Tile, TileGrid } from './hierarchy';
import { Dialog } from '../dialogs/Dialog';
import { PitchBadge, pitchSummary } from '../match/PitchBadge';

/**
 * The ground, and what the club can do about it.
 *
 * The club screen already says where the club stands and what needs the manager,
 * and the ground is one of those things rather than a screen of its own: a
 * Sunday club's pitch *is* its biggest asset and its oldest argument, and it
 * belongs beside the balance and the committee. So this is a section of the
 * Clubhouse screen, and nothing here is a second opinion about anything —
 * `groundSummary` decides what is on offer, what it costs, whether the club can
 * afford it and why not, and the actions take the same decision, which is why
 * the sentence on the button and the sentence in the dialog cannot disagree.
 *
 * Read top to bottom it answers the three questions a manager has: *what have we
 * got* (the drawing, the numbers, and the day's own verdict on the surface),
 * *what is being done* (work in hand, with the date and the way out), and *what
 * could be done* (each job priced, with what it would change measured against
 * the fixtures the club actually has left). The upkeep is last, because it is
 * not a job — it is the standing decision that decides whether any of it lasts.
 */
export function GroundPanel({ clubId }: { clubId: ClubId }) {
  const game = useGame();
  const [question, setQuestion] = useState<GroundQuestion | null>(null);
  const summary = useMemo(() => (game ? groundSummary(game, clubId) : null), [game, clubId]);
  if (!game || !summary) return null;

  const spentOnGround = summary.history.reduce((sum, project) => sum + project.cost, 0);
  const inHand = summary.inHand.length > 0;
  const somethingToLose = summary.quality > summary.baselineQuality;

  return (
    <>
      <Section
        title="The ground"
        id="ground"
        action={<span className="small muted">{summary.holdsTheGround ? 'The club holds it' : 'Hired'}</span>}
      >
        <Panel
          title={summary.groundName}
          subtitle={[summary.townName, summary.surface, `${summary.capacity} capacity`].filter(Boolean).join(' · ')}
          level="default"
        >
          {/* The same drawing and the same verdict the matchday card uses, from
              the same function: the ground screen and the morning of the game
              cannot say different things about the same pitch. */}
          <div className="briefing__pitch">
            <PitchBadge conditions={summary.conditions} />
            <div>
              <p>
                <strong>{pitchSummary(summary.conditions)}</strong>
              </p>
              <p className="small muted">
                Today at {summary.groundName}: {summary.conditions.weather}, {summary.conditions.temperatureC}°C.
              </p>
            </div>
          </div>
          <dl className="facts facts--inline">
            <Fact
              label="Pitch"
              value={
                summary.quality === summary.baselineQuality
                  ? `${summary.quality}/20`
                  : `${summary.quality}/20 · ${summary.quality > summary.baselineQuality ? 'up' : 'down'} from ${summary.baselineQuality}`
              }
            />
            <Fact label="Drainage" value={`${summary.drainage}/20`} />
            <Fact label="Floodlights" value={summary.hasFloodlights ? 'Yes' : 'No'} />
            <Fact label="Changing rooms" value={summary.hasChangingRooms ? 'Yes' : 'No'} />
            <Fact label="Clubhouse" value={summary.hasClubhouse ? 'Yes' : 'No'} />
          </dl>
          {spentOnGround > 0 && (
            <p className="small muted">
              {moneyWhole(spentOnGround)} has gone into this ground so far, across {summary.history.length}{' '}
              {summary.history.length === 1 ? 'job' : 'jobs'}.
            </p>
          )}
        </Panel>

        {!summary.holdsTheGround && (
          <Callout tone="warn" title="The club does not hold this ground">
            {summary.holderName ?? 'Another club'} holds it and the club hires it. The pitch and anything built on it
            are theirs to commission — the club can still pay for the ground to be looked after, and that is the one
            decision it has here.
          </Callout>
        )}
        {summary.inAdministration && (
          <Callout tone="bad" title="The club is in administration">
            Nothing is spent on the ground while the club is in the red. Get the books straight and the work can be
            commissioned again.
          </Callout>
        )}

        {inHand && (
          <Panel title="Work in hand" level="primary" subtitle="The money has gone out; the ground changes on the day it is finished.">
            <ul className="tight-list">
              {summary.inHand.map((project) => (
                <li key={project.id}>
                  <div className="row row--wrap">
                    <strong>{GROUND_WORKS[project.work].label}</strong>
                    <Pill tone="time">Stage {project.level}</Pill>
                    <span className="muted small">{moneyWhole(project.cost)} paid {formatShortDate(project.startedOn)}</span>
                    <span className="small">Finished around {project.completesOn}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      ariaLabel={`Cancel the ${GROUND_WORKS[project.work].label.toLowerCase()}`}
                      onClick={() => setQuestion({ kind: 'cancel', project })}
                    >
                      Pull out
                    </Button>
                  </div>
                  <p className="small muted">{GROUND_WORKS[project.work].blurb}</p>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <TileGrid min={250}>
          {summary.options.map((option) => (
            <GroundWorkTile
              key={option.work}
              option={option}
              onCommission={() => setQuestion({ kind: 'commission', option })}
            />
          ))}
        </TileGrid>

        <Panel
          title={summary.upkeep.on ? 'The ground is being looked after' : 'Nobody is looking after the ground'}
          tone={summary.upkeep.on ? 'default' : somethingToLose ? 'warn' : 'default'}
          level={somethingToLose && !summary.upkeep.on ? 'primary' : 'quiet'}
        >
          <p className="small muted">{summary.upkeep.detail}</p>
          <p>
            Every fourth home fixture, a winter of Sundays takes a point off the surface — unless the club is paying
            for the pitch to be cut, marked, rolled and covered. That is the whole of it:{' '}
            <strong>
              {summary.upkeep.on
                ? `${moneyWhole(summary.upkeep.perWeek)} a week holds the pitch at ${summary.quality}/20.`
                : `the surface is at ${summary.quality}/20 and can go back down to ${summary.baselineQuality}/20 without it.`}
            </strong>
          </p>
          <div className="row row--wrap row--tight">
            <Button
              variant={summary.upkeep.on ? 'ghost' : 'primary'}
              onClick={() => gameActions().setGroundUpkeep(!summary.upkeep.on)}
            >
              {summary.upkeep.on ? 'Stop paying for it' : `Take it on — ${moneyWhole(summary.upkeep.perWeek)} a week`}
            </Button>
            {summary.upkeep.on && summary.upkeep.nextDue && (
              <span className="small muted">Next charged {formatShortDate(summary.upkeep.nextDue)}.</span>
            )}
          </div>
        </Panel>

        {summary.history.length > 0 && (
          <details className="more">
            <summary>What has been done to the ground</summary>
            <ul className="tight-list">
              {summary.history.map((project) => (
                <li key={project.id}>
                  <div className="row row--wrap">
                    <strong>{GROUND_WORKS[project.work].label}</strong>
                    <span className="muted small">{moneyWhole(project.cost)}</span>
                    <span className="small">
                      {project.cancelledOn ? `Cancelled ${formatShortDate(project.cancelledOn)}` : `Finished ${formatShortDate(project.completedOn!)}`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      {question?.kind === 'commission' && (
        <Dialog
          title="Commission the work?"
          kind="confirm"
          narrow
          onClose={() => setQuestion(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setQuestion(null)}>
                Not now
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  gameActions().commissionGroundWork(question.option.work);
                  setQuestion(null);
                }}
              >
                Commission it
              </Button>
            </>
          }
        >
          <p>
            <strong>{question.option.label}</strong> — {question.option.blurb}
          </p>
          <p>
            {moneyWhole(question.option.cost)} leaves the club's account today, and the work is done around{' '}
            <strong>{question.option.completesOn}</strong>. That leaves {moneyWhole(summary.balance - question.option.cost)}{' '}
            in the bank, against everything else the club has to pay for this month.
          </p>
          <p className="small muted">
            {question.option.change}. {question.option.effect}
          </p>
        </Dialog>
      )}

      {question?.kind === 'cancel' && (
        <Dialog
          title="Pull out of the work?"
          kind="confirm"
          narrow
          onClose={() => setQuestion(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setQuestion(null)}>
                Keep it on
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  gameActions().cancelGroundWork(question.project.id);
                  setQuestion(null);
                }}
              >
                Cancel the work
              </Button>
            </>
          }
        >
          <p>
            The {GROUND_WORKS[question.project.work].label.toLowerCase()} would be cancelled and the contractor would
            keep half of the {moneyWhole(question.project.cost)} already paid.
          </p>
          <p className="small muted">The ground is not touched, so the club loses the money and nothing else.</p>
        </Dialog>
      )}
    </>
  );
}

type GroundQuestion =
  | { kind: 'commission'; option: GroundWorkOption }
  | { kind: 'cancel'; project: GroundWorkProject };

/**
 * One job on offer.
 *
 * A job that cannot be done is still drawn, with the reason in the tile rather
 * than hidden behind a disabled button: a manager who cannot relay his pitch
 * because the ground is not his has to be told that, not left tapping a control
 * that does nothing. Only the two states worth naming are pill'd — available,
 * or short of the money — because "in hand" and "done" are things the rest of
 * the panel already says.
 *
 * A job there is nothing left of is drawn *empty*: no price, no date and no
 * arrow, because there is no stage to sell and a tile reading "Floodlights yes
 * → yes" for £0 is the screen failing to notice that it already won.
 */
function GroundWorkTile({
  option,
  onCommission,
}: {
  option: GroundWorkOption;
  onCommission: () => void;
}) {
  // What the footer says when the job cannot be started, in the manager's terms
  // rather than the state's: a job held up by the one already on site is not the
  // same as one the club cannot afford, and neither is the same as a job done.
  const footerNote =
    option.available
      ? null
      : option.blocked === 'complete'
        ? 'Nothing left to do'
        : option.blocked === 'in-hand'
          ? 'Waiting for the work in hand'
          : option.blocked === 'administration'
            ? 'Not while the club is in the red'
            : option.blocked === 'tenancy'
              ? 'The landlord’s job'
              : 'Short of the money';
  const done = option.blocked === 'complete';
  return (
    <Tile
      label={option.label}
      level={option.available ? 'default' : 'quiet'}
      tone={option.blocked === 'complete' ? 'muted' : option.affordable ? 'default' : 'warn'}
      footer={
        option.available ? (
          <Button size="sm" variant="primary" onClick={onCommission}>
            Commission — {moneyWhole(option.cost)}
          </Button>
        ) : (
          <span className="small muted">{footerNote}</span>
        )
      }
    >
      <p className="small muted">{option.blurb}</p>
      {!done && (
        <p>
          <strong>{option.change}</strong>
        </p>
      )}
      {!done &&
        option.forecast?.map((line) => (
          <p key={line} className="small muted">
            {line}
          </p>
        ))}
      <div className="row row--tight row--wrap">
        {done ? (
          <Pill tone="muted">Already in place</Pill>
        ) : (
          <>
            {option.maxLevel > 1 && (
              <Pill tone="muted">
                Stage {option.level} of {option.maxLevel}
              </Pill>
            )}
            {option.affordable ? (
              <Pill tone={option.available ? 'ok' : 'muted'}>
                {moneyWhole(option.cost)} · {option.days} days
              </Pill>
            ) : (
              <Pill tone="warn">{moneyWhole(option.cost)} — more than the club has</Pill>
            )}
          </>
        )}
      </div>
      {option.available ? (
        <p className="small muted">Done around {option.completesOn}.</p>
      ) : (
        <p className="small">{option.reason}</p>
      )}
    </Tile>
  );
}
