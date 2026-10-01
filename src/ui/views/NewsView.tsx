import { useState } from 'react';
import type { NewsCategory } from '@/domain/news';
import { formatDate, formatDayMonth, formatShortDate } from '@/simulation/calendar';
import { gameActions, useGame } from '../hooks';
import { playerName } from '../format';
import { isPlayer } from '@/domain/person';
import { Button, EmptyState, PageHeader, Panel, Pill } from '../components/primitives';
import { ClubLink, PlayerLink } from '../components/Links';

const FILTERS: Array<NewsCategory | 'All'> = ['All', 'Match', 'Squad', 'Club', 'League', 'World', 'Finances'];

/**
 * News.
 *
 * Everything the local game has to say, in the order it said it. There is no
 * separate model here: these are the same items the club reacts to, just given
 * a screen of their own rather than being squeezed onto the overview.
 */
export function NewsView() {
  const game = useGame();
  const [filter, setFilter] = useState<NewsCategory | 'All'>('All');
  if (!game) return null;

  const club = game.clubs[game.userClubId]!;
  const items = filter === 'All' ? game.news : game.news.filter((item) => item.category === filter);
  const notable = club.history.notableEvents.slice(0, 12);

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Media"
        title="News"
        subtitle="Reports about your club, the division and the local game. Nothing here is invented twice — these are the same events the club acts on."
        actions={
          <Button variant="ghost" onClick={() => gameActions().setView('dashboard')}>
            Back to the overview
          </Button>
        }
      />

      <Panel
        level="primary"
        title={filter === 'All' ? 'Everything' : `${filter} news`}
        subtitle={`${items.length} item${items.length === 1 ? '' : 's'} on file`}
        actions={
          <div className="row row--wrap">
            {FILTERS.map((option) => (
              <button
                key={option}
                type="button"
                className={`tab${filter === option ? ' tab--active' : ''}`}
                onClick={() => setFilter(option)}
              >
                {option}
              </button>
            ))}
          </div>
        }
      >
        {items.length === 0 && (
          <EmptyState
            action={
              <Button variant="ghost" onClick={() => setFilter('All')}>
                Show everything
              </Button>
            }
          >
            Nothing has been written about {filter === 'All' ? 'the club' : filter.toLowerCase()} yet.
          </EmptyState>
        )}
        {/* Grouped by the day the thing happened: with continuous time, the
            date is the spine of the feed rather than a detail on each item. */}
        <div className="flow--text">
        {Array.from(new Set(items.slice(0, 60).map((item) => item.date))).map((date) => (
          <div key={date}>
            <h3 className="news__day">{formatDate(date)}</h3>
            <ul className="news">
              {items
                .filter((item) => item.date === date)
                .slice(0, 60)
                .map((item) => {
                  const people = item.personIds
                    .map((id) => game.people[id])
                    .filter(isPlayer)
                    .slice(0, 2);
                  return (
                    <li key={item.id} className={`news__item news__item--${item.importance}`}>
                      <div className="news__head">
                        <Pill tone={item.category === 'Squad' ? 'accent' : 'muted'}>{item.category}</Pill>
                        <span className="muted small">{formatDayMonth(item.date)}</span>
                        {item.importance === 3 && <Pill tone="warn">One to remember</Pill>}
                      </div>
                      <strong>{item.headline}</strong>
                      <p className="small muted">{item.body}</p>
                      {(people.length > 0 || item.clubIds.length > 0) && (
                        <div className="row row--wrap">
                          {item.clubIds.slice(0, 2).map((clubId) => (
                            <ClubLink key={clubId} clubId={clubId} />
                          ))}
                          {people.map((person) => (
                            <PlayerLink key={person.id} personId={person.id}>
                              {playerName(person)}
                            </PlayerLink>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
        </div>
        {items.length > 60 && <p className="muted small">Showing the most recent 60 of {items.length}.</p>}
      </Panel>

      <Panel
        level="quiet"
        title="The archive remembers"
        subtitle="The moments the club has written down, as opposed to the ones the county talked about"
      >
        {notable.length === 0 && <p className="empty">Nothing has gone into the archive yet.</p>}
        <ul className="timeline">
          {notable.map((event, index) => (
            <li key={`${event.date}-${index}`} className={`timeline__item timeline__item--${event.importance}`}>
              <span className="timeline__date">{formatShortDate(event.date)}</span>
              <span>{event.description}</span>
              <span className="muted small">{event.seasonLabel}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
