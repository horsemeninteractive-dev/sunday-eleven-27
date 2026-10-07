import { ageOn } from '@/domain/manager';
import { formatShortDate } from '@/simulation/calendar';
import { ordinal } from '@/simulation/news';
import { formOf, leaguePosition, managerCareerRecord, userClub, userManager } from '@/simulation/queries';
import { gameActions, useGame } from '../hooks';
import { Button, Fact, FormPips, PageHeader, Panel, Pill } from '../components/primitives';
import { MetricTile, TileGrid } from '../components/hierarchy';
import { ClubLink } from '../components/Links';
import { ClubBadge } from '../components/Badge';
import { Glyph } from '../components/icons';
import { AdaptivePanels } from '../components/AdaptivePanels';

export function ManagerView() {
  const game = useGame();
  if (!game) return null;
  const club = userClub(game);
  const profile = game.managerProfile;
  const official = userManager(game);
  const record = managerCareerRecord(game);
  const age = ageOn(profile.birthday, game.date);
  const tenure = club.history.managers.find(entry => entry.personId === 'user_manager');
  const inChargeSince = tenure?.from ?? game.season.startDate;
  const position = leaguePosition(game, club.id);
  const thisSeason = club.history.seasons.find(season => season.seasonId === game.season.id);

  return <div className="stack manager-screen">
    <div className="manager-identity">
      <span className="manager-identity__portrait" aria-hidden="true"><Glyph name="manager" /></span>
      <PageHeader
        eyebrow="Your managerial career"
        title={`${profile.firstName} ${profile.surname}`}
        subtitle={`${profile.occupation || 'Volunteer'} · manager of ${club.identity.name}`}
        meta={<>
          <span className="small muted">Age {age} · born {formatShortDate(profile.birthday)}</span>
          {profile.nickname && <span className="small muted">Known as “{profile.nickname}”</span>}
          {profile.hometown && <span className="small muted">From {profile.hometown}</span>}
          {official && <span className="small muted">{Math.round(official.reputation)} local standing</span>}
        </>}
      />
      <ClubBadge club={club} size={88} />
    </div>
    <TileGrid min={175}>
      <MetricTile label="Seasons" value={record.seasons} note="Including this one" />
      <MetricTile label="Competitive matches" value={record.played} note={`${record.won}W · ${record.drawn}D · ${record.lost}L`} />
      <MetricTile label="Win rate" value={record.played > 0 ? `${record.winPercent}%` : '—'} note={`${record.points} points earned`} />
    </TileGrid>
    <AdaptivePanels name="manager" panels={[
      { id: 'job', label: 'Current job', content: <Panel title="The current job" className="workspace-panel">
        <div className="manager-job"><ClubBadge club={club} size={48} /><div><ClubLink clubId={club.id} /><p className="small muted">In charge since {formatShortDate(inChargeSince)}</p></div></div>
        <dl className="facts">
          <Fact label="Season" value={game.season.label} />
          <Fact label="League position" value={position ? ordinal(position) : 'Not yet in a table'} />
          <Fact label="This season" value={thisSeason ? `${thisSeason.won}W · ${thisSeason.drawn}D · ${thisSeason.lost}L (${thisSeason.points} pts)` : 'Not started'} />
        </dl>
        <div className="manager-form"><span className="small muted">Recent form</span><FormPips form={formOf(game, club.id, 5)} /></div>
      </Panel> },
      { id: 'record', label: 'Career record', content: <Panel title="Career record" className="workspace-panel">
        {record.played > 0 ? <>
          <div className="career-results" aria-label={`${record.won} won, ${record.drawn} drawn, ${record.lost} lost`}>
            {(['won', 'drawn', 'lost'] as const).map(result => <span key={result} className={`career-results__${result}`} style={{ flex: record[result] }} />)}
          </div>
          <dl className="career-outcomes"><Fact label="Won" value={record.won} /><Fact label="Drawn" value={record.drawn} /><Fact label="Lost" value={record.lost} /></dl>
        </> : <p className="empty">Your record starts with the opening competitive match.</p>}
        {/* Three numbers on one line, the same shape as the W/D/L strip above:
            in the two-column facts list a third pair wrapped on its own and
            pushed the label away from its own figure. */}
        <dl className="career-outcomes career-outcomes--figures"><Fact label="Scored" value={record.goalsFor} /><Fact label="Conceded" value={record.goalsAgainst} /><Fact label="Points" value={record.points} /></dl>
      </Panel> },
      { id: 'honours', label: 'Club honours', wide: true, content: <Panel title="Club honours" className="workspace-panel" actions={<Button variant="ghost" size="sm" onClick={() => gameActions().setView('history')}>Club history</Button>}>
        <div className="honours-display"><Glyph name="league" /><div>{club.history.honours.length ? <div className="row row--wrap">{club.history.honours.map(honour => <Pill key={honour} tone="accent">{honour}</Pill>)}</div> : <p className="muted">Nothing in the cabinet yet. The story is still being written.</p>}<p className="small muted">The club's honours, not a claim that you won them all.</p></div></div>
      </Panel> },
    ]} />
  </div>;
}
