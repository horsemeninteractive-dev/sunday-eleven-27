import { ageOn } from '@/domain/manager';
import { formatShortDate } from '@/simulation/calendar';
import { ordinal } from '@/simulation/news';
import { formOf, leaguePosition, managerCareerRecord, userClub, userManager } from '@/simulation/queries';
import { gameActions, useGame } from '../hooks';
import { Button, Fact, FormPips, PageHeader, Panel, Pill, Stat } from '../components/primitives';
import { ClubLink } from '../components/Links';

/**
 * The manager's own profile.
 *
 * Everything the career knows about the man in charge rather than the club:
 * who he says he is, how old he is now, and what he has actually done. The
 * record is read from the club's season figures — a season's wins and losses
 * are written as they happen — so it stays honest as the years go by rather
 * than needing to be remembered separately.
 */
export function ManagerView() {
  const game = useGame();
  if (!game) return null;

  const club = userClub(game);
  const profile = game.managerProfile;
  const official = userManager(game);
  const record = managerCareerRecord(game);
  const age = ageOn(profile.birthday, game.date);
  const name = `${profile.firstName} ${profile.surname}`;
  const tenure = club.history.managers.find((entry) => entry.personId === 'user_manager');
  const inChargeSince = tenure ? tenure.from : game.season.startDate;
  const position = leaguePosition(game, club.id);
  const thisSeason = club.history.seasons.find((season) => season.seasonId === game.season.id);
  const form = formOf(game, club.id, 5);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Manager"
        title={name}
        subtitle={
          profile.nickname
            ? `“${profile.nickname}” · in charge of ${club.identity.name}`
            : `In charge of ${club.identity.name}`
        }
        meta={
          <>
            <Pill tone="accent">Age {age}</Pill>
            {official && <Pill tone="muted">{Math.round(official.reputation)} standing</Pill>}
            <span className="small muted">Took charge {formatShortDate(inChargeSince)}</span>
          </>
        }
        actions={
          <Button variant="ghost" onClick={() => gameActions().setView('history')}>
            Club history
          </Button>
        }
      />

      <div className="manager__grid">
        <Panel title="Who you are" subtitle="How the local game knows you">
          <dl className="facts">
            <Fact label="Full name" value={name} />
            <Fact label="Nickname" value={profile.nickname || '—'} />
            <Fact label="Age" value={age} />
            <Fact label="Date of birth" value={formatShortDate(profile.birthday)} />
            <Fact label="Day job" value={profile.occupation || '—'} />
            <Fact label="From" value={profile.hometown || '—'} />
          </dl>
        </Panel>

        <Panel
          level="primary"
          title="Career record"
          subtitle="Competitive matches only — friendlies never count"
        >
          <div className="stat-grid stat-grid--wide">
            <Stat label="Seasons" value={record.seasons} hint="Seasons in charge, including this one" />
            <Stat label="Played" value={record.played} />
            <Stat label="Won" value={record.won} />
            <Stat label="Drawn" value={record.drawn} />
            <Stat label="Lost" value={record.lost} />
            <Stat label="Win rate" value={record.played > 0 ? `${record.winPercent}%` : '—'} />
            <Stat label="Goals for / against" value={`${record.goalsFor} / ${record.goalsAgainst}`} />
            <Stat label="Points" value={record.points} />
          </div>
          {record.played === 0 ? (
            <p className="muted small">
              No competitive matches yet. The record starts on the opening Sunday.
            </p>
          ) : (
            <p className="small">
              Recent form <FormPips form={form} /> <span className="muted">in the league</span>
            </p>
          )}
        </Panel>
      </div>

      <Panel title={`In charge at ${club.identity.name}`} subtitle="The current job">
        <dl className="facts">
          <Fact label="Club" value={<ClubLink clubId={club.id} />} />
          <Fact label="Took charge" value={formatShortDate(inChargeSince)} />
          <Fact
            label="This season"
            value={thisSeason ? `${thisSeason.won}W ${thisSeason.drawn}D ${thisSeason.lost}L (${thisSeason.points} pts)` : '—'}
          />
          <Fact label="League position" value={position ? `${ordinal(position)}` : 'Not yet in a table'} />
        </dl>

        {club.history.honours.length > 0 ? (
          <ul className="tight-list">
            {club.history.honours.map((honour) => (
              <li key={honour}>
                <Pill tone="accent">Honour</Pill> {honour}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">
            Nothing in the cabinet yet. The first thing to hang on the clubhouse wall is still out there.
          </p>
        )}
      </Panel>
    </div>
  );
}
