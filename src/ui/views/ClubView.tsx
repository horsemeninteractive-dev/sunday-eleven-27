import { CLUB_STRUCTURE_LABEL } from '@/domain/club';
import { GOVERNANCE_STANDING_LABEL } from '@/domain/governance';
import { currentMatchday, formOf, leaguePosition, squadAvailability, squadOf, userClub } from '@/simulation/queries';
import { leagueMatchdayCount } from '@/simulation/timeline';
import { secretarySummary } from '@/simulation/secretary';
import { governanceSummary } from '@/simulation/governance';
import { renewalText, sponsorshipSummary, weeklySponsorshipIncome } from '@/simulation/sponsorship';
import { treasurerSummary } from '@/simulation/treasurer';
import { formatDate, formatShortDate } from '@/simulation/calendar';
import { ordinal } from '@/simulation/news';
import { gameActions, useGame } from '../hooks';
import { openMatter } from '../commandActions';
import { CLUB_MATTER_LIMIT, clubMatters, clubRoster } from '../clubMatters';
import { moneyShort } from '../format';
import { Button, EmptyState, FormPips, PageHeader, Pill } from '../components/primitives';
import { ActionTile, MetricTile, Section, Tile, TileGrid } from '../components/hierarchy';
import { ClubBadge } from '../components/Badge';
import { StaffCard } from '../components/StaffCard';

/**
 * Club.
 *
 * One screen that answers the three questions a manager actually has about the
 * organisation he has joined: **who runs this place**, **where does it stand**,
 * and **what needs me**. Everything on it is a reading of a system that already
 * exists — the roster from the staff records, the standing from the league, the
 * balance from the ledger, the sponsor from the agreement — and every card is a
 * door rather than a sentence, because a fact a manager cannot act on is not a
 * fact he needed.
 *
 * It is deliberately not a dashboard of everything. Staff, Finances, Media and
 * History are all one tap away in the same section of the sidebar, so this
 * screen shows the *shape* of the club and the handful of things that are asking
 * for a decision, and then gets out of the way. Nothing here is shown merely
 * because the simulation knows it.
 */
export function ClubView() {
  const game = useGame();
  if (!game) return null;

  const club = userClub(game);
  const roster = clubRoster(game, club.id);
  const matters = clubMatters(game, CLUB_MATTER_LIMIT);
  const position = leaguePosition(game, club.id);
  const breakdown = squadAvailability(game, club.id);
  const squad = squadOf(game, club.id);
  const sponsor = sponsorshipSummary(game, club.id);
  const treasurer = treasurerSummary(game, club.id);
  const board = governanceSummary(game, club.id);
  const desk = secretarySummary(game, club.id);

  const weeklyIn = weeklySponsorshipIncome(game, club.id);
  const weeklyOut = club.finances.weeklyGroundCost + club.finances.insurancePerWeek + club.finances.trainingCostPerWeek;
  const net = weeklyIn - weeklyOut;
  const town = game.world.towns[club.townId]?.name ?? null;

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Club"
        title={<span className="person-identity"><ClubBadge club={club} size={48} />{club.identity.name}</span>}
        subtitle={[town, CLUB_STRUCTURE_LABEL[club.structure], club.identity.nickname].filter(Boolean).join(' · ')}
        meta={
          <>
            <span className="small muted">{formatDate(game.date)}</span>
            <span className="small muted">
              {game.season.label} · matchday {currentMatchday(game)} of {leagueMatchdayCount(game)}
            </span>
            <FormPips form={formOf(game, club.id)} />
          </>
        }
        actions={
          <div className="row row--wrap row--tight">
            <Button size="sm" variant="ghost" onClick={() => gameActions().setView('staff')}>
              All staff
            </Button>
            <Button size="sm" variant="ghost" onClick={() => gameActions().setView('finances')}>
              The books
            </Button>
          </div>
        }
      />

      <section className="club-home"><div><h2>{game.world.grounds[club.groundId]?.name ?? 'Home ground'}</h2><p className="small muted">{town} · {game.world.grounds[club.groundId]?.surface} · founded {club.identity.foundedYear}</p><p className="club-identity__motto">{club.identity.motto}</p></div><Button variant="ghost" onClick={() => gameActions().openProfile({ kind: 'club', id: club.id })}>Ground, squad and club profile</Button></section>
      <Section
        title="Who runs it"
        id="roster"
        action={
          <span className="small muted">
            {roster.length} on the committee
            {board.chairmanName ? ` · ${GOVERNANCE_STANDING_LABEL[board.standing]}` : ''}
          </span>
        }
      >
        <ul className="staff-roster">
          {roster.map((person) => {
            // The committee is the same committee the Staff screen draws, so it
            // is the same card: the office, the man, how he is, what is on him
            // and the one action, in the same slots. `name` is already what to
            // say when the post is empty — the roster works that out, not us.
            const who = game.people[person.personId] ?? null;
            return (
              <StaffCard
                key={`${person.role}-${person.personId}`}
                office={person.roleLabel}
                person={who}
                vacant={person.name}
                status={
                  <>
                    {/* Only once there is somebody in the post: availability is
                        a fact about a person, and an empty office is neither
                        around nor away. */}
                    {who && (
                      <Pill tone={person.available ? 'ok' : 'warn'}>{person.available ? 'Around' : 'Away'}</Pill>
                    )}
                    {person.competence && <Pill tone="muted">{person.competence}</Pill>}
                  </>
                }
                action={
                  person.isManager ? undefined : (
                    <Button
                      size="sm"
                      variant="ghost"
                      // The word on the button is the same for everybody, so the
                      // name goes on the accessible one: a screen reader hearing
                      // five buttons called "Message" learns nothing.
                      ariaLabel={`Message ${person.name}`}
                      title={`Start a conversation with ${person.name}`}
                      onClick={() => gameActions().startConversationWith(person.personId)}
                    >
                      Message
                    </Button>
                  )
                }
                detail={who ? `Age ${who.age} · ${who.occupation}` : 'This post is vacant'}
                duty={who ? who.notes[who.notes.length - 1] : undefined}
                // The current issue, where there is one. This is the line the
                // manager is looking for, so it is the only thing allowed under
                // a name — not an attribute table.
                issue={person.issue}
              />
            );
          })}
        </ul>
      </Section>

      <Section title="Where it stands">
        <TileGrid min={185}>
          <MetricTile
            label="League"
            value={position ? ordinal(position) : '—'}
            note={position ? `${game.season.label} · ${squad.length} registered` : 'Not started'}
            tone="default"
          />
          <MetricTile
            label="Squad"
            value={`${breakdown.available.length} available`}
            note={`${breakdown.doubtful.length} doubtful · ${breakdown.unavailable.length} out`}
            tone={breakdown.available.length < 14 ? 'warn' : 'ok'}
          />
          <MetricTile
            label="Balance"
            value={moneyShort(treasurer.balance)}
            note={`${net >= 0 ? '+' : ''}${moneyShort(net)} a week`}
            tone={treasurer.balance < 0 ? 'bad' : treasurer.balance < 120 ? 'warn' : 'ok'}
          />
          <MetricTile
            label="Sponsor"
            value={sponsor.sponsorName ?? 'None'}
            note={
              sponsor.deal
                ? `${moneyShort(sponsor.instalment)} ${sponsor.frequency === 'weekly' ? 'a week' : 'a month'} · ${renewalText(game, sponsor)}`
                : 'No agreement in place'
            }
            tone={!sponsor.deal ? 'warn' : sponsor.issue ? 'bad' : 'default'}
          />
        </TileGrid>
      </Section>

      <Section
        title="What needs you"
        id="what-needs-you"
        action={
          matters.length > 0 ? (
            <span className="small muted">
              {desk.outstanding.length > 0
                ? `${desk.outstanding.length} on the secretary's desk`
                : board.concerns.length > 0
                  ? 'The committee is watching'
                  : 'Nothing else outstanding'}
            </span>
          ) : undefined
        }
      >
        {matters.length === 0 ? (
          <EmptyState>
            Nothing needs you. The committee is in place, the books add up and the team is picked.
          </EmptyState>
        ) : (
          <TileGrid min={230}>
            {matters.map((matter) => (
              <ActionTile
                key={matter.id}
                label={matter.label}
                title={matter.title}
                meta={matter.detail}
                tone={matter.tone}
                onClick={matter.destination ? () => openMatter(matter.destination) : undefined}
                disabled={!matter.destination}
              />
            ))}
          </TileGrid>
        )}
      </Section>

      <details className="more"><summary>Club departments · staff, money, news and history</summary><Section>
        <TileGrid min={190}>
          <Tile label="Staff" onClick={() => gameActions().setView('staff')}>
            <span className="metric__value">{roster.length}</span>
            <span className="metric__note">Roles, availability and what is on them</span>
          </Tile>
          <Tile label="Finances" onClick={() => gameActions().setView('finances')}>
            <span className="metric__value">{moneyShort(treasurer.balance)}</span>
            <span className="metric__note">
              {treasurer.outstanding.length > 0 ? `${moneyShort(treasurer.outstandingTotal)} owed to the club` : 'Everyone is paid up'}
            </span>
          </Tile>
          <Tile label="Media" onClick={() => gameActions().setView('news')}>
            <span className="metric__value">{game.news.filter((item) => item.clubIds.includes(club.id)).length}</span>
            <span className="metric__note">Stories about this club</span>
          </Tile>
          <Tile label="History" onClick={() => gameActions().setView('history')}>
            <span className="metric__value">{club.history.notableEvents.length}</span>
            <span className="metric__note">Founded {club.history.founded}</span>
          </Tile>
        </TileGrid>
      </Section></details>

      {board.events.length > 0 && (
        <Section title="Matters of record">
          <ul className="tight-list">
            {board.events.slice(0, 3).map((event) => (
              <li key={event.id}>
                <div className="row row--wrap">
                  <span className="muted small">{formatShortDate(event.date)}</span>
                  <strong>{event.title}</strong>
                </div>
                <div className="muted small">{event.detail}</div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
