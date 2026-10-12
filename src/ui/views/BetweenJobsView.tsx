import { formatShortDate } from '@/simulation/calendar';
import { runCommand } from '../commandActions';
import { gameActions, useGame } from '../hooks';
import { Button, Fact, PageHeader, Panel, Pill } from '../components/primitives';
import { MetricTile, TileGrid } from '../components/hierarchy';
import { ClubBadge } from '../components/Badge';
import { ClubLink } from '../components/Links';

/**
 * Out of work.
 *
 * The one screen there is when a manager has no club. It is deliberately not a
 * club screen with the club missing: there is nothing to pick, nobody to sign
 * and no fixture to prepare, so it is the two things that are still true — the
 * record he has built, and the posts he can apply for. Continue still works, and
 * is the only other thing to do: the days have to pass before a committee calls.
 */
export function BetweenJobsView() {
  const game = useGame();
  if (!game) return null;

  const career = game.career;
  const lastClub = career?.lastClubId ? game.clubs[career.lastClubId] : undefined;
  const spells = [...(career?.spells ?? [])].reverse();
  const openings = career?.openings ?? [];
  const applied = new Set(career?.applied ?? []);
  // The day the last job ended, which is not the day he is reading this.
  // `game.date` is whenever the manager happens to be looking at the screen, so
  // "Out of work since" was true on the first morning and wrong on every morning
  // after it. The spell he left carries its own end date, and it is the same one
  // the record below prints beside the club.
  const outOfWorkSince = spells.find((spell) => spell.to)?.to ?? null;

  return (
    <div className="stack between-jobs">
      <PageHeader
        eyebrow="Your managerial career"
        title="Between jobs"
        subtitle={
          lastClub
            ? [
                outOfWorkSince ? `Out of work since ${formatShortDate(outOfWorkSince)}` : 'Out of work',
                `most recently ${lastClub.identity.name}`,
              ].join(' · ')
            : 'Out of work, and looking for a club.'
        }
        meta={
          <>
            <span className="small muted">{game.season.label}</span>
            <span className="small muted">
              {openings.length === 0
                ? 'No vacancies just now'
                : `${openings.length} club${openings.length === 1 ? '' : 's'} looking for a manager`}
            </span>
          </>
        }
      />

      {/* Why the rest of the game is not on the screen: the club screens went
          with the job, and saying so is the difference between a career and a
          game that has quietly stopped. */}
      <p className="small muted">
        The squad, the tactics sheet and the books belong to whoever follows you. Your messages, the local paper and the
        world around the county are still yours — and the club screens come back the day a committee takes you on.
      </p>

      <TileGrid min={175}>
        <MetricTile label="Clubs managed" value={career?.spells?.length ?? 0} note="Including the one you left" />
        <MetricTile label="Open posts" value={openings.length} note="Apply before the window closes" />
      </TileGrid>

      <Panel
        title="The job board"
        className="workspace-panel"
        actions={<Button variant="ghost" size="sm" onClick={() => runCommand({ kind: 'action', action: 'continue' })}>Move the days on</Button>}
      >
        {openings.length === 0 ? (
          <p className="empty">
            No club is advertising just now. The board fills when a committee decides on a change — usually in the
            summer. Keep moving the days on and keep an eye on it.
          </p>
        ) : (
          <ul className="jobboard">
            {openings.map((opening) => {
              const club = game.clubs[opening.clubId];
              if (!club) return null;
              const already = applied.has(opening.clubId);
              return (
                <li key={opening.clubId} className="jobboard__row">
                  <span className="jobboard__crest">
                    <ClubBadge club={club} size={40} />
                  </span>
                  <span className="jobboard__body">
                    <span className="jobboard__name">
                      <ClubLink clubId={club.id} />
                    </span>
                    <span className="small muted">{opening.note}</span>
                    <span className="small muted">Open until {formatShortDate(opening.closesOn)}</span>
                  </span>
                  <span className="jobboard__action">
                    {already ? (
                      <Pill tone="muted">Applied</Pill>
                    ) : (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => gameActions().applyForJob(opening.clubId)}
                      >
                        Apply
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Your record" className="workspace-panel">
        {spells.length === 0 ? (
          <p className="empty">No clubs managed yet.</p>
        ) : (
          <ul className="spellbook">
            {spells.map((spell, index) => {
              const club = game.clubs[spell.clubId];
              const record = club?.history.seasons ?? [];
              const played = record.reduce((sum, season) => sum + season.played, 0);
              const won = record.reduce((sum, season) => sum + season.won, 0);
              const points = record.reduce((sum, season) => sum + season.points, 0);
              return (
                <li key={`${spell.clubId}-${index}`} className="spellbook__row">
                  {club ? <ClubBadge club={club} size={36} /> : null}
                  <div className="spellbook__body">
                    <div>{club ? <ClubLink clubId={club.id} /> : <span>a club</span>}</div>
                    <p className="small muted">
                      {formatShortDate(spell.from)} – {spell.to ? formatShortDate(spell.to) : 'now'}
                      {spell.ending === 'dismissed' ? ' · parted ways' : ''}
                    </p>
                    {played > 0 ? (
                      <dl className="facts facts--inline">
                        <Fact label="Played" value={played} />
                        <Fact label="Won" value={won} />
                        <Fact label="Points" value={points} />
                      </dl>
                    ) : null}
                  </div>
                  {spell.to === null ? <Pill tone="accent">Current</Pill> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
