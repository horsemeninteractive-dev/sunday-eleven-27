import { useEffect, useRef, useState } from 'react';
import type { Club } from '@/domain/club';
import { CLUB_STRUCTURE_LABEL } from '@/domain/club';
import { ATTRIBUTE_DESCRIPTORS } from '@/domain/attributes';
import { isPlayer, personDisplayName, type Player, type PlayerHistoryEntry } from '@/domain/person';
import { POSITIONS, POSITION_GROUP_LABEL } from '@/domain/positions';
import {
  CANDIDATE_STATUS_LABEL,
  DISCOVERY_SOURCE_LABEL,
  KNOWLEDGE_CONFIDENCE_LABEL,
  knowledgeLines,
} from '@/domain/recruitment';
import { describeSetPieceWork, describeSystemFamiliarity } from '@/domain/training';
import { formatShortDate } from '@/simulation/calendar';
import {
  bestPositionFor,
  clubMatches,
  estimateAbilityBand,
  leaguePosition,
  squadOf,
  type AbilityBand,
} from '@/simulation/queries';
import { candidateInterest } from '@/simulation/recruitment/interest';
import { joiningProspect } from '@/simulation/recruitment/signing';
import { candidateOf } from '@/simulation/recruitment/store';
import { RELATIONSHIP_PROVENANCE_LABEL } from '@/domain/relationship';
import { socialProfileOf, visibleRelationshipViewsFor } from '@/simulation/relationships';
import { developmentSummary } from '@/simulation/training/development';
import type { ProfileTarget } from '@/state/gameStore';
import { moneyShort } from '../format';
import { gameActions, useGame } from '../hooks';
import { clubKit } from '../kit';
import { AttributeRow, Button, Meter, Panel, Pill, SortTh, Stat } from './primitives';
import { ClubBadge } from './Badge';
import { KitSetRow } from './Kit';
import { PositionMap } from './PositionMap';
import { ClubLink, PlayerLink, ProfileNavProvider, useOpenProfile } from './Links';
import { applySort, UNSORTED, type SortAccessors, type SortState } from '../tableSort';

type CareerSortKey = 'season' | 'club' | 'apps' | 'goals' | 'assists';

const CAREER_SORT: SortAccessors<PlayerHistoryEntry, CareerSortKey> = {
  season: (entry) => entry.seasonLabel,
  club: (entry) => entry.clubId ?? '',
  apps: (entry) => entry.appearances,
  goals: (entry) => entry.goals,
  assists: (entry) => entry.assists,
};

type ClubSquadSortKey = 'player' | 'pos' | 'age' | 'level';

/** Worst first, so sorting by level ranks the squad the way a scout would. */
const BAND_ORDER: AbilityBand[] = ['Poor', 'Limited', 'Solid', 'Good', 'Very good', 'Exceptional'];

const CLUB_SQUAD_SORT: SortAccessors<Player, ClubSquadSortKey> = {
  player: (player) => `${player.surname} ${player.firstName}`,
  pos: (player) => player.preferredPosition,
  age: (player) => player.age,
  level: (player) => BAND_ORDER.indexOf(estimateAbilityBand(player)),
};

/**
 * A profile.
 *
 * Football Manager's most-used screen: everything about a person or a club on
 * one page, laid out as small labelled facts rather than a wall of prose. Names
 * inside it are doors too, so following a link walks the manager through the
 * world — and back again.
 *
 * The profile also respects what the game actually knows. Inside his own squad
 * the manager sees the real numbers; outside it he sees bands, sources and
 * impressions, because that is all he has ever been told.
 */
export function ProfileOverlay({ target }: { target: ProfileTarget }) {
  const [stack, setStack] = useState<ProfileTarget[]>([target]);
  // The stack is the profile's own history, so it has to be thrown away when
  // something *outside* the profile opens a different one — otherwise the new
  // face appears underneath the trail that led to the last one.
  const [opened, setOpened] = useState<ProfileTarget>(target);
  if (target !== opened) {
    setOpened(target);
    setStack([target]);
  }
  const current = stack[stack.length - 1]!;
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // A new face starts at the top of its own page. Without this, following a
  // name from halfway down a long profile drops you halfway down the next man's.
  useEffect(() => {
    overlayRef.current?.scrollTo({ top: 0 });
  }, [current.kind, current.id]);

  const push = (next: ProfileTarget) => {
    setStack((entries) => {
      const top = entries[entries.length - 1];
      if (top && top.kind === next.kind && top.id === next.id) return entries;
      return [...entries, next];
    });
  };
  const back = () => setStack((entries) => (entries.length > 1 ? entries.slice(0, -1) : entries));

  return (
    <ProfileNavProvider open={push}>
      <div className="overlay" role="dialog" aria-modal="true" aria-label="Profile" ref={overlayRef}>
        <div className="overlay__panel">
          <div className="overlay__bar">
            <span className="overlay__title">{current.kind === 'club' ? 'Club profile' : 'Player profile'}</span>
            <div className="row row--tight">
              {stack.length > 1 && (
                <Button variant="ghost" size="sm" onClick={back}>
                  ← Back
                </Button>
              )}
              <button
                type="button"
                className="overlay__close"
                aria-label="Close profile"
                onClick={() => gameActions().closeProfile()}
              >
                ✕
              </button>
            </div>
          </div>
          {current.kind === 'club' ? <ClubProfile clubId={current.id} /> : <PlayerProfile personId={current.id} />}
        </div>
      </div>
    </ProfileNavProvider>
  );
}

/* ------------------------------------------------------------------ player */

function PlayerProfile({ personId }: { personId: string }) {
  const [careerSort, setCareerSort] = useState<SortState<CareerSortKey>>(UNSORTED);
  const game = useGame();
  const openProfile = useOpenProfile();
  if (!game) return null;

  const person = game.people[personId];
  if (!person || !isPlayer(person)) {
    return (
      <div className="overlay__body">
        <Panel title="Not found">
          <p className="empty">There is nobody by that name in the local game.</p>
        </Panel>
      </div>
    );
  }

  const player: Player = person;
  const club = player.clubId ? game.clubs[player.clubId] : undefined;
  const town = player.townId ? game.world.towns[player.townId] : undefined;
  const isMine = player.clubId === game.userClubId;
  const candidate = candidateOf(game, player.id);
  const best = bestPositionFor(player);
  const improving = developmentSummary(game, player);
  const profile = socialProfileOf(game, player.id);
  const relationships = visibleRelationshipViewsFor(game, player.id).slice(0, 6);
  const knowledge = candidate ? knowledgeLines(candidate.knowledge) : [];

  return (
    <>
      {/* The name and nothing else: who he is, whose he is, how good he is, and
          where he plays. Everything personal belongs in a card, said once. */}
      <div className="profilehead">
        <div className="profilehead__name">
          <span className="crest crest--lg" aria-hidden="true">
            {club ? (
              <ClubBadge club={club} />
            ) : (
              <span className="crest__empty">—</span>
            )}
          </span>
          <div>
            <h2>{personDisplayName(player)}</h2>
            <div className="row row--tight">
              {club ? <ClubLink clubId={club.id} /> : <span className="muted">Not playing anywhere</span>}
              <Pill tone="muted">
                {player.preferredPosition} · {POSITIONS[player.preferredPosition].label}
              </Pill>
              <Pill tone="accent">{estimateAbilityBand(player)}</Pill>
              {player.registered ? <Pill tone="ok">Registered</Pill> : <Pill tone="muted">Unregistered</Pill>}
              {candidate && <Pill tone="warn">{CANDIDATE_STATUS_LABEL[candidate.status]}</Pill>}
            </div>
          </div>
        </div>
      </div>

      <div className="overlay__body">
        <div className="profile-grid profile-grid--person">
          {/* Where he plays: one small pitch instead of twelve rows. */}
          <Panel
            title="Where he plays"
            subtitle={`Best role: ${best.position} (${Math.round(best.score * 100)}/100)`}
            level="default"
          >
            <PositionMap player={player} />
            <p className="muted small">
              {isMine
                ? 'Playing him out of position is allowed — the match engine works out what it costs you.'
                : 'Roles are your impression from what you have seen, not what he would tell you.'}
            </p>
          </Panel>

          {/* Everything about the man himself, said once. */}
          <Panel title="Status & personal" subtitle={player.occupation} level="default">
            <div className="readiness">
              <Readiness label="Fitness" value={player.fitness} />
              <Readiness label="Form" value={player.form} />
              <Readiness label="Morale" value={player.morale} />
            </div>
            <div className="facts">
              <Row label="Condition" value={conditionText(player)} />
              <Row label="Injury" value={player.injury ? player.injury.description : 'No active injuries'} />
              <Row label="Availability" value={player.availability.status} />
              {player.availability.note && <Row label="This week" value={player.availability.note} />}
              <Row label="Age" value={String(player.age)} />
              <Row label="Height" value={`${player.heightCm}cm`} />
              <Row label="Personality" value={player.personality} />
              <Row label="Home town" value={town?.name ?? '—'} />
              <Row label="Joined" value={formatShortDate(player.joinedClubOn)} />
              <Row label="Position group" value={POSITION_GROUP_LABEL[player.positionGroup]} />
              <Row label="Deal" value="Non-contract (Sunday League)" />
              <Row label="Subs" value={`£${club?.finances.subscriptionPerPlayer ?? 5}/wk`} />
              <Row label="Registration" value={player.registered ? 'Registered' : 'Not registered'} />
            </div>
          </Panel>

          {isMine ? (
            <Panel title="The way we play" subtitle="Learned on Thursday nights" level="default">
              <div className="facts">
                <Row label="Shape" value={describeSystemFamiliarity((player.systemFamiliarity?.formation ?? 10) / 20)} />
                <Row
                  label="Instructions"
                  value={describeSystemFamiliarity((player.systemFamiliarity?.instructions ?? 10) / 20)}
                />
                <Row label="Set pieces" value={describeSetPieceWork((player.systemFamiliarity?.setPieces ?? 10) / 20)} />
              </div>
              {improving.length > 0 && <p className="small muted">{improving.join(' · ')}.</p>}
            </Panel>
          ) : (
            <Panel
              title="Scouting"
              subtitle={
                candidate
                  ? DISCOVERY_SOURCE_LABEL[candidate.discoveredVia]
                  : 'You have never had a proper look at him'
              }
              level="default"
            >
              {candidate ? (
                <>
                  <p className="small">{candidate.sourceNote}</p>
                  <div className="facts">
                    <Row label="On the list since" value={formatShortDate(candidate.discoveredOn)} />
                    <Row label="Sessions with you" value={String(candidate.trials)} />
                    <Row label="Status" value={CANDIDATE_STATUS_LABEL[candidate.status]} />
                  </div>
                  <p className="small">
                    <strong>{joiningProspect(game, player.id)}</strong>
                  </p>
                  <h4 className="subhead">What you know</h4>
                  {knowledge.length === 0 && <p className="muted small">Nothing yet. Watch him, or get him down.</p>}
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
                  {candidate.knowledge.notes.length > 0 && (
                    <ul className="bullets">
                      {candidate.knowledge.notes.slice(-4).map((note, index) => (
                        <li key={`${note}-${index}`}>{note}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="muted small">
                  He plays for {club?.identity.shortName ?? 'somebody else'}. Nothing is known about him here — the local
                  game runs on word of mouth, so wait until somebody mentions his name.
                </p>
              )}
            </Panel>
          )}
        </div>

        <div className="split split--sidebar">
          {isMine ? (
            <Panel title="Attributes" subtitle="Hidden characteristics stay hidden — you get impressions instead">
              {(['technical', 'physical', 'mental', 'behavioural'] as const).map((groupKey) => (
                <div className="attr-group" key={groupKey}>
                  <h4 className="subhead">{groupKey}</h4>
                  {ATTRIBUTE_DESCRIPTORS.filter((descriptor) => descriptor.group === groupKey).map((descriptor) => (
                    <AttributeRow
                      key={descriptor.key}
                      label={descriptor.label}
                      value={(player.attributes[groupKey] as unknown as Record<string, number>)[descriptor.key] ?? 1}
                      visible={descriptor.visible}
                    />
                  ))}
                </div>
              ))}
            </Panel>
          ) : (
            <Panel title="What you can say for definite" subtitle="Everything else is somebody's opinion">
              <div className="facts">
                <Row label="Age" value={String(player.age)} />
                <Row label="Current club" value={club?.identity.name ?? 'Not registered'} />
                <Row label="Day job" value={player.occupation} />
                <Row label="General impression" value={estimateAbilityBand(player)} />
                <Row label="Registered" value={player.registered ? 'Yes' : 'No'} />
              </div>
              <p className="muted small">
                {candidate
                  ? `You have a view on ${knowledge.length} part${knowledge.length === 1 ? '' : 's'} of his game, all of it second hand until you see him yourself.`
                  : 'You have not seen enough of him to form a view. That is what watching and sessions are for.'}
              </p>
              {candidate && (
                <>
                  <h4 className="subhead">Would he come?</h4>
                  <ul className="tight-list">
                    {candidateInterest(game, player.id, game.userClubId).reasons.map((reason, index) => (
                      <li key={`${reason.text}-${index}`}>
                        <div className="row row--wrap">
                          <Pill tone={reason.weight >= 0 ? 'ok' : 'bad'}>{reason.weight >= 0 ? 'for' : 'against'}</Pill>
                          <span className="small">{reason.text}</span>
                        </div>
                        <div className="muted small">“{reason.quote}”</div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>
          )}

          <div className="stack">
            <Panel title="Actions" level="primary">
              <div className="profile-actions">
                {candidate ? (
                  <>
                    <Button
                      variant="primary"
                      block
                      onClick={() => {
                        gameActions().closeProfile();
                        gameActions().openNegotiation(player.id);
                      }}
                    >
                      Talk terms
                    </Button>
                    <Button variant="ghost" block onClick={() => gameActions().watchCandidate(player.id)}>
                      Go and watch him
                    </Button>
                    <Button variant="ghost" block onClick={() => gameActions().inviteToTrial(player.id)}>
                      Invite him to a session
                    </Button>
                    <Button variant="ghost" block onClick={() => gameActions().approachCandidate(player.id)}>
                      Ask him directly
                    </Button>
                    <Button variant="danger" block onClick={() => gameActions().passOnCandidate(player.id)}>
                      Not for us
                    </Button>
                  </>
                ) : isMine ? (
                  <>
                    <Button
                      variant="primary"
                      block
                      onClick={() => {
                        gameActions().closeProfile();
                        gameActions().setView('team');
                      }}
                    >
                      Team selection
                    </Button>
                    <Button
                      variant="ghost"
                      block
                      onClick={() => {
                        gameActions().closeProfile();
                        gameActions().setView('training');
                      }}
                    >
                      Thursday's session
                    </Button>
                    <p className="muted small">He is yours. What happens to him happens on the pitch and on Thursdays.</p>
                  </>
                ) : club ? (
                  <>
                    <Button variant="ghost" block onClick={() => openProfile({ kind: 'club', id: club.id })}>
                      {club.identity.shortName}
                    </Button>
                    <p className="muted small">
                      You can watch him, but recruitment starts with somebody mentioning his name. Ask the squad, look in
                      at five-a-side, or put a session on.
                    </p>
                  </>
                ) : (
                  <p className="muted small">
                    He is not registered with anybody. Word of mouth is the only way in — he will have to be mentioned to
                    you first.
                  </p>
                )}
              </div>
            </Panel>

            <Panel title="Career history" level="default">
              <div className="table-wrapper">
                <table className="table table--compact table--numeric">
                  <thead>
                    <tr>
                      <SortTh label="Season" sortKey="season" sort={careerSort} onSort={setCareerSort} />
                      <SortTh label="Club" sortKey="club" sort={careerSort} onSort={setCareerSort} />
                      <SortTh label="Apps" sortKey="apps" sort={careerSort} onSort={setCareerSort} />
                      <SortTh label="Goals" sortKey="goals" sort={careerSort} onSort={setCareerSort} />
                      <SortTh label="Assists" sortKey="assists" sort={careerSort} onSort={setCareerSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {player.record.seasons.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted small">
                          No seasons on record.
                        </td>
                      </tr>
                    )}
                    {applySort(player.record.seasons, careerSort, CAREER_SORT).map((entry) => (
                      <tr key={`${entry.seasonLabel}-${entry.clubId ?? 'none'}`}>
                        <td>{entry.seasonLabel}</td>
                        <td>
                          {entry.clubId && game.clubs[entry.clubId] ? (
                            <ClubLink clubId={entry.clubId}>{game.clubs[entry.clubId]!.identity.shortName}</ClubLink>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>{entry.appearances}</td>
                        <td>{entry.goals}</td>
                        <td>{entry.assists}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h4 className="subhead">This season</h4>
              <div className="stat-grid stat-grid--wide">
                <Stat label="Apps" value={player.record.appearances} />
                <Stat label="From bench" value={player.record.substituteAppearances} />
                <Stat label="Goals" value={player.record.goals} />
                <Stat label="Assists" value={player.record.assists} />
                <Stat label="Yellow" value={player.record.yellowCards} />
                <Stat label="Red" value={player.record.redCards} />
              </div>
            </Panel>

            <Panel title="Around him" level="quiet">
              <div className="row row--tight">
                {profile.informalLeader && <Pill tone="ok">Dressing-room leader</Pill>}
                {profile.troublemaker && <Pill tone="warn">Handle with care</Pill>}
              </div>
              {relationships.length === 0 && (
                <p className="muted small">Nothing much is known about who he knows beyond the dressing room.</p>
              )}
              <ul className="tight-list">
                {relationships.map((view) => (
                  <li key={view.otherId}>
                    <div className="row row--wrap">
                      <PlayerLink personId={view.otherId} />
                      <Pill tone={view.summary.tone === 'close' || view.summary.tone === 'good' ? 'ok' : 'muted'}>
                        {view.summary.label}
                      </Pill>
                      <span className="muted small">{view.originLabel}</span>
                    </div>
                    <div className="muted small">
                      {RELATIONSHIP_PROVENANCE_LABEL[view.provenance]}
                      {view.latest ? ` · “${view.latest.description}”` : ''}
                    </div>
                  </li>
                ))}
              </ul>
              {player.notes.length > 0 && (
                <>
                  <h4 className="subhead">Notes</h4>
                  <ul className="bullets">
                    {player.notes.slice(-4).map((note, index) => (
                      <li key={`${note}-${index}`}>{note}</li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------- club */

type ClubTab = 'season' | 'squad' | 'ground' | 'money';

/** The club inspector's screens, in the order a manager wants them. */
const CLUB_TABS: Array<{ id: ClubTab; label: string }> = [
  { id: 'season', label: 'Season' },
  { id: 'squad', label: 'Squad' },
  { id: 'ground', label: 'Ground' },
  { id: 'money', label: 'Money' },
];

function ClubProfile({ clubId }: { clubId: string }) {
  const game = useGame();
  const [tab, setTab] = useState<ClubTab>('season');
  const [squadSort, setSquadSort] = useState<SortState<ClubSquadSortKey>>(UNSORTED);
  if (!game) return null;
  const club: Club | undefined = game.clubs[clubId];
  if (!club) {
    return (
      <div className="overlay__body">
        <Panel title="Not found">
          <p className="empty">That club is not in this division.</p>
        </Panel>
      </div>
    );
  }

  const town = game.world.towns[club.townId];
  const ground = game.world.grounds[club.groundId];
  const manager = club.managerId ? game.people[club.managerId] : undefined;
  const squad = squadOf(game, club.id);
  const position = leaguePosition(game, club.id);
  const kit = clubKit(game, club.id);
  const season = club.history.seasons[0];
  const played = clubMatches(game, club.id)
    .filter((match) => match.played)
    .slice(-6)
    .reverse();

  return (
    <>
      <div className="profilehead">
        <div className="profilehead__name">
          <span className="crest crest--xl" aria-hidden="true">
            <ClubBadge club={club} />
          </span>
          <div>
            <h2>{club.identity.name}</h2>
            <div className="row row--tight">
              <span className="muted small">{club.identity.nickname}</span>
              <Pill tone="muted">{CLUB_STRUCTURE_LABEL[club.structure]}</Pill>
              {club.id === game.userClubId && <Pill tone="accent">your club</Pill>}
            </div>
          </div>
        </div>

        {/* One strip of the facts you always want, full width and on its own
            band, rather than floating off to the right of the name. */}
        <div className="quickstats">
          <QuickStat label="Town" value={town?.name ?? '—'} />
          <QuickStat label="Ground" value={ground?.name ?? '—'} />
          <QuickStat label="Manager" value={manager ? personDisplayName(manager) : '—'} />
          <QuickStat label="Founded" value={club.identity.foundedYear} />
          <QuickStat label="In the league" value={position ? `${position}` : '—'} />
          <QuickStat label="Registered" value={squad.length} />
          <QuickStat label="Standing" value={`${Math.round(club.reputation)}/100`} />
          <QuickStat label="Balance" value={moneyShort(club.finances.balance)} />
        </div>
      </div>

      <div className="overlay__body">
        <div className="profilebody">
          {/* Left: what the club looks like. The kit is heavy artwork, so it
              gets a column of its own instead of floating under the name. */}
          <div className="profilebody__side">
            {kit && (
              <Panel title="The kit" subtitle={`${kit.season} · ${kit.maker.name}`} level="default">
                <KitSetRow club={club} kit={kit} size={84} />
                <p className="muted small">
                  {kit.sponsor
                    ? `${kit.sponsor.name} across the chest, the club's crest over the heart.`
                    : 'No shirt sponsor this season — a blank chest on all three strips.'}
                </p>
              </Panel>
            )}

            {/* Nothing here repeats the strip above or the kit beside it: the
                founded year, the kit firm and the sponsor are all already said. */}
            <Panel title="Identity" level="quiet">
              <p className="clubquote">“{club.identity.motto}”</p>
              <div className="facts">
                <Row label="Run by" value={CLUB_STRUCTURE_LABEL[club.structure]} />
                <Row label="Chairman" value={game.people[club.chairmanId ?? '']?.surname ?? '—'} />
                <Row label="Nickname" value={club.identity.nickname} />
              </div>
              <h4 className="subhead">Rivalries</h4>
              {Object.keys(club.rivalries).length === 0 ? (
                <p className="muted small">No established rivalries.</p>
              ) : (
                <ul className="tight-list">
                  {Object.entries(club.rivalries).map(([id, rivalry]) => (
                    <li key={id}>
                      <div className="row row--wrap">
                        <ClubLink clubId={id} />
                        <Pill tone={rivalry.intensity > 60 ? 'bad' : 'warn'}>{Math.round(rivalry.intensity)}</Pill>
                      </div>
                      <div className="muted small">{rivalry.note}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {/* Right: one inspector, four screens of facts. Nothing is stacked
              off the bottom of the viewport where nobody can find it. */}
          <div className="inspector">
            <div className="inspector__tabs" role="tablist" aria-label="Club">
              {CLUB_TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === entry.id}
                  className={`inspector__tab${tab === entry.id ? ' inspector__tab--active' : ''}`}
                  onClick={() => setTab(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <div className="inspector__panel" role="tabpanel">
              {tab === 'season' && (
                <>
                  <div className="stat-grid stat-grid--wide">
                    <Stat label="Played" value={season?.played ?? 0} />
                    <Stat label="Won" value={season?.won ?? 0} />
                    <Stat label="Drawn" value={season?.drawn ?? 0} />
                    <Stat label="Lost" value={season?.lost ?? 0} />
                    <Stat label="Goals" value={`${season?.goalsFor ?? 0}/${season?.goalsAgainst ?? 0}`} />
                    <Stat label="Points" value={season?.points ?? 0} />
                  </div>
                  <h4 className="subhead">Recent results</h4>
                  {played.length === 0 && <p className="muted small">No matches played yet.</p>}
                  {played.map((match) => {
                    const home = game.clubs[match.homeClubId]!;
                    const away = game.clubs[match.awayClubId]!;
                    const isHome = match.homeClubId === club.id;
                    const mine = isHome ? match.result!.homeGoals : match.result!.awayGoals;
                    const theirs = isHome ? match.result!.awayGoals : match.result!.homeGoals;
                    return (
                      <div className="result-row" key={match.id}>
                        <span className="muted small">{formatShortDate(match.date)}</span>
                        <span>
                          {home.identity.shortName} {match.result!.homeGoals}–{match.result!.awayGoals}{' '}
                          {away.identity.shortName}
                        </span>
                        <Pill tone={mine > theirs ? 'ok' : mine === theirs ? 'warn' : 'bad'}>
                          {mine > theirs ? 'W' : mine === theirs ? 'D' : 'L'}
                        </Pill>
                      </div>
                    );
                  })}
                  <h4 className="subhead">Honours</h4>
                  {club.history.honours.length === 0 ? (
                    <p className="muted small">Nothing in the cabinet yet.</p>
                  ) : (
                    <ul className="bullets">
                      {club.history.honours.slice(0, 6).map((honour) => (
                        <li key={honour}>{honour}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              {tab === 'squad' && (
                <>
                  <div className="table-wrapper">
                    <table className="table table--compact">
                      <thead>
                        <tr>
                          <SortTh label="Player" sortKey="player" sort={squadSort} onSort={setSquadSort} />
                          <SortTh label="Pos" sortKey="pos" sort={squadSort} onSort={setSquadSort} />
                          <SortTh label="Age" sortKey="age" sort={squadSort} onSort={setSquadSort} />
                          <SortTh label="Level" sortKey="level" sort={squadSort} onSort={setSquadSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {squad.length === 0 && (
                          <tr>
                            <td colSpan={4} className="muted small">
                              Nobody registered.
                            </td>
                          </tr>
                        )}
                        {applySort(squad, squadSort, CLUB_SQUAD_SORT).map((player) => (
                          <tr key={player.id}>
                            <td>
                              <PlayerLink personId={player.id}>
                                {player.surname}
                                {player.nickname ? ` “${player.nickname}”` : ''}
                              </PlayerLink>
                              <div className="muted small">{player.firstName}</div>
                            </td>
                            <td>{player.preferredPosition}</td>
                            <td>{player.age}</td>
                            <td className="muted small">{estimateAbilityBand(player)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted small">Names open their profiles without leaving this one.</p>
                </>
              )}

              {tab === 'ground' && (
                <>
                  <div className="facts">
                    <Row label="Name" value={ground?.name ?? '—'} />
                    <Row label="Town" value={town?.name ?? '—'} />
                    <Row label="Surface" value={ground?.surface ?? '—'} />
                    <Row label="Pitch quality" value={`${ground?.quality ?? 0}/20`} />
                    <Row label="Drainage" value={`${ground?.drainage ?? 0}/20`} />
                    <Row label="Capacity" value={String(ground?.capacity ?? 0)} />
                    <Row label="Floodlights" value={ground?.hasFloodlights ? 'Yes' : 'No'} />
                    <Row label="Changing rooms" value={ground?.hasChangingRooms ? 'Yes' : 'No'} />
                    <Row label="Clubhouse" value={ground?.hasClubhouse ? 'Yes' : 'No'} />
                    <Row
                      label="Shared with"
                      value={ground && ground.sharedWith.length > 0 ? `${ground.sharedWith.length + 1} clubs` : 'Nobody'}
                    />
                    <Row label="Pitch hire" value={ground ? `£${ground.matchdayCost} a game` : '—'} />
                  </div>
                  <p className="muted small">
                    Drainage is what costs a Sunday in February: a waterlogged pitch is the most common way a fixture is lost.
                  </p>
                </>
              )}

              {tab === 'money' && (
                <>
                  <div className="stat-grid stat-grid--wide">
                    <Stat label="Balance" value={moneyShort(club.finances.balance)} />
                    <Stat label="Subs" value={`£${club.finances.subscriptionPerPlayer}`} hint="Per player, per week" />
                    <Stat label="Sponsorship" value={`£${club.finances.sponsorIncomePerWeek}`} hint="Per week" />
                    <Stat label="Ground" value={`£${club.finances.weeklyGroundCost}`} hint="Per week" />
                    <Stat label="Training" value={`£${club.finances.trainingCostPerWeek}`} hint="Per week" />
                    <Stat label="Insurance" value={`£${club.finances.insurancePerWeek}`} hint="Per week" />
                  </div>
                  <div className="facts">
                    <Row label="League fee" value={`£${club.finances.annualLeagueFee} a season`} />
                    <Row label="Ledger entries" value={String(club.finances.ledger.length)} />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ pieces */

/** One item of the quick facts strip under a profile's name. */
function QuickStat({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="quickstat">
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

/**
 * A 0-100 number as a bar and a word, for the things about a player that move
 * week to week: fitness, form and morale. Three rows of text in a column told
 * the manager nothing at a glance; three bars do.
 */
function Readiness({ label, value }: { label: string; value: number }) {
  const tone = value >= 70 ? 'ok' : value >= 45 ? 'warn' : 'bad';
  return (
    <div className="readiness__row">
      <span className="readiness__label">{label}</span>
      <Meter value={value} tone={tone} />
      <span className={`readiness__word readiness__word--${tone}`}>{readinessWord(value)}</span>
      <span className="readiness__value num">{Math.round(value)}%</span>
    </div>
  );
}

function readinessWord(value: number): string {
  if (value >= 85) return 'Excellent';
  if (value >= 70) return 'Good';
  if (value >= 55) return 'Fine';
  if (value >= 45) return 'Average';
  if (value >= 30) return 'Poor';
  return 'Badly off';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="facts__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function conditionText(player: Player): string {
  if (player.availability.status === 'unavailable') return player.availability.note ?? 'Not available';
  if (player.fitness >= 88) return 'Ready for a full match';
  if (player.fitness >= 70) return 'Good for most of a game';
  if (player.fitness >= 50) return 'An hour at most';
  return 'Running on empty';
}


