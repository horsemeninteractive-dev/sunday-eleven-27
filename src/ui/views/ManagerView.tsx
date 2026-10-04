import { ageOn } from '@/domain/manager';
import { formatShortDate } from '@/simulation/calendar';
import { ordinal } from '@/simulation/news';
import { formOf, leaguePosition, managerCareerRecord, userClub, userManager } from '@/simulation/queries';
import { gameActions, useGame } from '../hooks';
import { Button, Fact, FormPips, PageHeader, Panel, Pill } from '../components/primitives';
import { MetricTile, Section, TileGrid } from '../components/hierarchy';
import { ClubLink } from '../components/Links';

/**
 * The manager's own profile.
 *
 * Name, role, club, standing and the career record — the things the local game
 * knows about the man in charge. Biographical detail sits beside it, not in
 * front of it.
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
        meta={
          <>
            <span className="small muted">{club.identity.name}</span>
            <span className="small muted">age {age}</span>
            {official && <span className="small muted">{Math.round(official.reputation)} standing</span>}
            <span className="small muted">in charge since {formatShortDate(inChargeSince)}</span>
          </>
        }
      />

      <TileGrid min={175}>
        <MetricTile label="Seasons" value={record.seasons} note="In charge, including this one" />
        <MetricTile label="Played" value={record.played} note={`${record.won}W ${record.drawn}D ${record.lost}L`} />
        <MetricTile label="Win rate" value={record.played > 0 ? `${record.winPercent}%` : '—'} note={`${record.points} points`} />
        <MetricTile label="Goals" value={`${record.goalsFor} / ${record.goalsAgainst}`} note="For / against" />
        <MetricTile label="This season" value={thisSeason ? `${thisSeason.points} pts` : '—'} note={thisSeason ? `${thisSeason.won}W ${thisSeason.drawn}D ${thisSeason.lost}L` : ''} />
        <MetricTile label="League" value={position ? ordinal(position) : '—'} note={record.played > 0 ? 'recent form below' : ''} />
      </TileGrid>

      {record.played > 0 && (
        <Section title="Recent form">
          <FormPips form={form} />
        </Section>
      )}

      <div className="split split--sidebar">
        <Panel title="Career record">
          <dl className="facts">
            <Fact label="Competitive matches" value={record.played} />
            <Fact label="Won" value={record.won} />
            <Fact label="Drawn" value={record.drawn} />
            <Fact label="Lost" value={record.lost} />
            <Fact label="Points" value={record.points} />
            <Fact label="Goals for / against" value={`${record.goalsFor} / ${record.goalsAgainst}`} />
          </dl>
          {record.played === 0 && <p className="muted small">The record starts on the opening Sunday.</p>}
        </Panel>

        <Panel title="The current job">
          <dl className="facts">
            <Fact label="Club" value={<ClubLink clubId={club.id} />} />
            <Fact label="Took charge" value={formatShortDate(inChargeSince)} />
            <Fact
              label="This season"
              value={thisSeason ? `${thisSeason.won}W ${thisSeason.drawn}D ${thisSeason.lost}L (${thisSeason.points} pts)` : '—'}
            />
            <Fact label="League position" value={position ? ordinal(position) : 'Not yet in a table'} />
          </dl>
        </Panel>
      </div>

      <details className="more">
        <summary className="small muted">Who you are</summary>
        <Panel>
          <dl className="facts">
            <Fact label="Full name" value={name} />
            <Fact label="Nickname" value={profile.nickname || '—'} />
            <Fact label="Age" value={age} />
            <Fact label="Date of birth" value={formatShortDate(profile.birthday)} />
            <Fact label="Day job" value={profile.occupation || '—'} />
            <Fact label="From" value={profile.hometown || '—'} />
          </dl>
        </Panel>
      </details>

      <Section title="Honours">
        {club.history.honours.length > 0 ? (
          <div className="row row--wrap row--tight">
            {club.history.honours.map((honour) => (
              <Pill key={honour} tone="accent">
                {honour}
              </Pill>
            ))}
          </div>
        ) : (
          <p className="muted small">Nothing in the cabinet yet.</p>
        )}
        <div className="row" style={{ marginTop: 'var(--s2)' }}>
          <Button variant="ghost" size="sm" onClick={() => gameActions().setView('history')}>
            Club history
          </Button>
        </div>
      </Section>
    </div>
  );
}
