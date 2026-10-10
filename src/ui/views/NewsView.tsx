import { useState } from 'react';
import type { GameState } from '@/domain/game';
import type { NewsCategory, NewsItem } from '@/domain/news';
import { formatDate, formatShortDate } from '@/simulation/calendar';
import { useGame } from '../hooks';
import { playerName } from '../format';
import { isPlayer } from '@/domain/person';
import { EmptyState, PageHeader } from '../components/primitives';
import { ClubLink } from '../components/Links';
import { PersonLine } from '../components/PersonIdentity';
import { NewsPlate } from '../components/NewsPlate';

const FILTERS: Array<NewsCategory | 'All'> = ['All', 'Match', 'Squad', 'Club', 'League', 'World', 'Finances'];

/**
 * News.
 *
 * A paper, not a changelog. The screen opens on the one story the filter allows
 * — headline, standfirst, and the rest of it — and offers the others as cards
 * under the day they happened, beside a rail of what the club remembers. The
 * date is still the spine of the feed, because with continuous time it is the
 * only thing that orders it.
 *
 * The lead is taken *out* of the feed rather than repeated at the top of it, so
 * the days below are built from what is left: a day that held nothing but the
 * lead story gets no heading and no empty grid beneath it.
 */

/** Bodies are written as prose; a blank line is where the paper breaks. */
function paragraphsOf(item: NewsItem): string[] {
  return item.body
    .split(/\n\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/** Category, date, and a shout for the one importance level worth shouting about. */
function StoryMeta({ item }: { item: NewsItem }) {
  return (
    <span className="news-lead__meta">
      <span className="muted">{item.category}</span>
      <span className="muted">{formatShortDate(item.date)}</span>
      {item.importance === 3 && <span className="tone tone--warn">Important</span>}
    </span>
  );
}

/**
 * The clubs and the people a story is about.
 *
 * A story's clubs have always been drawn — the crest is how this game says which
 * club — and its people were only named, which made the same sentence say two
 * different things about two of the things it was about. They are drawn now, for
 * the same reason: a story about Kev Taylor is about a man, and the paper is
 * where a manager first meets him.
 */
function StoryLinks({ item, game }: { item: NewsItem; game: GameState }) {
  return (
    <div className="row row--wrap">
      {item.clubIds.map((clubId) => (
        <ClubLink key={clubId} clubId={clubId} />
      ))}
      {item.personIds
        .map((id) => game.people[id])
        .filter(isPlayer)
        .map((person) => (
          <PersonLine key={person.id} personId={person.id}>
            {playerName(person)}
          </PersonLine>
        ))}
    </div>
  );
}

/**
 * The story the screen opens on. It is not a `<details>` like the others: a lead
 * story you have to open is not leading with anything, so it is printed.
 */
function LeadStory({ item, game }: { item: NewsItem; game: GameState }) {
  const [opening, ...rest] = paragraphsOf(item);
  // The first paragraph only reads as a standfirst when there is something
  // underneath it to stand above. Every story the writer produces today is a
  // single paragraph, so the common case is the whole story set at body size
  // rather than one long line blown up to `--fs-lg` and left hanging.
  const leadsOn = rest.length > 0;
  return (
    <article className="news-lead">
      <NewsPlate category={item.category} className="news-plate--lead" />
      <StoryMeta item={item} />
      <h2 className="news-lead__headline">{item.headline}</h2>
      {opening && (
        <p className={leadsOn ? 'news-lead__standfirst' : 'news-lead__body'}>{opening}</p>
      )}
      {rest.map((paragraph, index) => (
        <p className="news-lead__body" key={index}>
          {paragraph}
        </p>
      ))}
      <StoryLinks item={item} game={game} />
    </article>
  );
}

export function NewsView() {
  const game = useGame();
  const [filter, setFilter] = useState<NewsCategory | 'All'>('All');
  const [limit, setLimit] = useState(12);
  if (!game) return null;

  const club = game.clubs[game.userClubId]!;
  const items = filter === 'All' ? game.news : game.news.filter((item) => item.category === filter);
  const notable = club.history.notableEvents.slice(0, 12);
  const shown = items.slice(0, limit);

  // The newest story the filter allows leads; everything else is the feed.
  const lead = shown[0];
  const rest = shown.slice(1);
  const dates = Array.from(new Set(rest.map((item) => item.date)));

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Media"
        title="News"
        photo="/photos/news-lead.webp"
        meta={<span className="small muted">{items.length} item{items.length === 1 ? '' : 's'}</span>}
        actions={
          <div className="row row--wrap row--tight">
            {FILTERS.map((option) => (
              <button
                key={option}
                type="button"
                className={`tab${filter === option ? ' tab--active' : ''}`}
                aria-pressed={filter === option}
                onClick={() => { setFilter(option); setLimit(12); }}
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
        <div className="news-layout">
          <div className="stack">
            {lead && <LeadStory item={lead} game={game} />}

            {dates.map((date) => (
              <section key={date}>
                <h2 className="news-day">{formatDate(date)}</h2>
                <div className="news-feed">
                  {rest
                    .filter((item) => item.date === date)
                    .map((item) => (
                      <details className="news-story" key={item.id}>
                        <summary>
                          <NewsPlate category={item.category} />
                          <span className="news-story__text">
                            <StoryMeta item={item} />
                            <span className="news-story__headline">{item.headline}</span>
                          </span>
                        </summary>
                        <div className="news-story__body">
                          {paragraphsOf(item).map((paragraph, index) => (
                            <p key={index}>{paragraph}</p>
                          ))}
                          <StoryLinks item={item} game={game} />
                        </div>
                      </details>
                    ))}
                </div>
              </section>
            ))}

            {items.length > limit && (
              <button type="button" className="btn btn--ghost" onClick={() => setLimit((value) => value + 12)}>
                Older headlines · {limit} of {items.length} shown
              </button>
            )}
          </div>

          {/* The rail is always drawn, even with an empty archive: it is the
              layout's second column, and a column that appears only sometimes
              would leave the feed hanging over a gap on a wide screen. */}
          <aside className="news-rail" aria-label="Club archive">
            <div className="news-rail__panel">
              <h2 className="news-rail__title">The archive remembers ({notable.length})</h2>
              {notable.length === 0 ? (
                <p className="small muted">Nothing in the archive yet.</p>
              ) : (
                <ul className="timeline">
                  {notable.map((event, index) => (
                    <li key={`${event.date}-${index}`} className={`timeline__item timeline__item--${event.importance}`}>
                      <span className="timeline__date">{formatShortDate(event.date)}</span>
                      <span>{event.description}</span>
                      <span className="muted small">{event.seasonLabel}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
