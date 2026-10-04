import { useState } from 'react';
import type { NewsCategory } from '@/domain/news';
import { formatDate, formatShortDate } from '@/simulation/calendar';
import { useGame } from '../hooks';
import { playerName } from '../format';
import { isPlayer } from '@/domain/person';
import { EmptyState, PageHeader } from '../components/primitives';
import { NewsTile, Section, TileGrid } from '../components/hierarchy';
import { ClubLink, PlayerLink } from '../components/Links';

const FILTERS: Array<NewsCategory | 'All'> = ['All', 'Match', 'Squad', 'Club', 'League', 'World', 'Finances'];

/**
 * News.
 *
 * A feed, not an essay: the headline is enough to know whether it matters, and
 * opening the story gives the detail. Grouped by the day it happened, because
 * with continuous time the date is the spine of the feed.
 */
export function NewsView() {
  const game = useGame();
  const [filter, setFilter] = useState<NewsCategory | 'All'>('All');
  if (!game) return null;

  const club = game.clubs[game.userClubId]!;
  const items = filter === 'All' ? game.news : game.news.filter((item) => item.category === filter);
  const notable = club.history.notableEvents.slice(0, 12);
  const dates = Array.from(new Set(items.slice(0, 60).map((item) => item.date)));

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Media"
        title="News"
        meta={<span className="small muted">{items.length} item{items.length === 1 ? '' : 's'}</span>}
        actions={
          <div className="row row--wrap row--tight">
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
      />

      {items.length === 0 ? (
        <EmptyState
          action={
            <button type="button" className="btn btn--ghost" onClick={() => setFilter('All')}>
              Show everything
            </button>
          }
        >
          Nothing has been written about {filter === 'All' ? 'the club' : filter.toLowerCase()} yet.
        </EmptyState>
      ) : (
        <div className="stack">
          {dates.map((date) => (
            <Section key={date} title={formatDate(date)}>
              <TileGrid min={300}>
                {items
                  .filter((item) => item.date === date)
                  .slice(0, 60)
                  .map((item) => (
                    <NewsTile
                      key={item.id}
                      category={item.category}
                      headline={item.headline}
                      summary={item.body}
                      date={formatShortDate(item.date)}
                      tone={
                        item.category === 'Squad'
                          ? 'accent'
                          : item.importance === 3
                            ? 'warn'
                            : item.category === 'Match'
                              ? 'ok'
                              : 'default'
                      }
                    />
                  ))}
              </TileGrid>
              {/* Names are still doors: the links sit under the headlines they
                  belong to rather than bloating every tile. */}
              <div className="row row--wrap row--tight" style={{ marginTop: 'var(--s2)' }}>
                {items
                  .filter((item) => item.date === date)
                  .flatMap((item) => [
                    ...item.clubIds.slice(0, 2).map((clubId) => (
                      <ClubLink key={`${item.id}-${clubId}`} clubId={clubId} />
                    )),
                    ...item.personIds
                      .map((id) => game.people[id])
                      .filter(isPlayer)
                      .slice(0, 2)
                      .map((person) => (
                        <PlayerLink key={`${item.id}-${person.id}`} personId={person.id}>
                          {playerName(person)}
                        </PlayerLink>
                      )),
                  ])}
              </div>
            </Section>
          ))}
          {items.length > 60 && <p className="muted small">Showing the most recent 60 of {items.length}.</p>}
        </div>
      )}

      {notable.length > 0 && (
        <details className="more">
          <summary className="small muted">The archive remembers ({notable.length})</summary>
          <ul className="timeline">
            {notable.map((event, index) => (
              <li key={`${event.date}-${index}`} className={`timeline__item timeline__item--${event.importance}`}>
                <span className="timeline__date">{formatShortDate(event.date)}</span>
                <span>{event.description}</span>
                <span className="muted small">{event.seasonLabel}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
