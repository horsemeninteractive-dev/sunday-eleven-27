import { useState } from 'react';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import type { NewsCategory, NewsItem } from '@/domain/news';
import { RUMOUR_STATUS_LABEL } from '@/domain/press';
import { formatDate, formatShortDate } from '@/simulation/calendar';
import { useGame } from '../hooks';
import { playerName } from '../format';
import { isPlayer } from '@/domain/person';
import { Button, EmptyState, PageHeader } from '../components/primitives';
import { ClubLink } from '../components/Links';
import { PersonLine } from '../components/PersonIdentity';
import { NewsPlate } from '../components/NewsPlate';
import { MatchScoreline } from '../match/MatchScoreline';
import { openMatchReport } from '../reportActions';
import { bylineOf, fixtureForStory, labelForStory, paragraphsOf, plateForStory, resultForStory, toneForConfidence } from '../newsStory';

const FILTERS: Array<NewsCategory | 'All'> = ['All', 'Match', 'Squad', 'Club', 'League', 'World', 'Finances'];

/**
 * How many stories the page gives a column of their own, after the lead.
 *
 * Two, and the number matters: a paper that promoted everything has promoted
 * nothing, and the whole point of the tier is that a reader can tell at a glance
 * which three things this issue is about. Everything else is a clipping under
 * the day it happened, which is where a manager looks for the rest.
 */
const FEATURES = 2;

/**
 * News.
 *
 * A paper, not a changelog. The screen opens on the one story the filter allows —
 * the lead, with the paper's own photograph behind it and *the story's own marks*
 * on it — then gives the next two a column each, then pins the rest of it as
 * clippings under the day they happened, beside a rail of what the club
 * remembers. The date is still the spine of the feed, because with continuous
 * time it is the only thing that orders it.
 *
 * Three things changed when the paper was given something to say. The picture on
 * a story is chosen from what actually happened rather than from the column it
 * was filed in (`newsStory.ts`), so a cup tie is not drawn as a league game and a
 * training night is not drawn as a signing. A story about football is headlined
 * by the football — the crests, the shirts and the score the rest of the game
 * already draws — rather than described in a sentence beside a generic pitch. And
 * a match story that has been played opens onto the way into its report, because
 * the paper is where a manager finds out what happened and the report is where he
 * reads it properly.
 *
 * The lead is taken *out* of the feed rather than repeated at the top of it, so
 * the days below are built from what is left: a day that held nothing but the
 * lead story gets no heading and no empty grid beneath it.
 */

/**
 * The line above a headline: what kind of story it is, which competition, when,
 * how much of it is fact, and a shout for the one importance level worth
 * shouting about.
 *
 * The kind is the story's own rather than its column's — "Signed" rather than
 * "Squad" — because it is the only place the paper says what a story *is*, and
 * "a squad story" says nothing about a man arriving.
 *
 * The paper it came from belongs in this row rather than in a second line of its
 * own, because on a real page the masthead is stamped into the same band as the
 * date; the reporter's own name is the thing that gets a line of its own, under
 * the headline, which is what `Byline` is.
 *
 * And a claim gets a chip, because the one thing a reader may never have to
 * guess at is whether he is looking at something that happened or something
 * somebody said. An ordinary report carries no chip at all: the absence is the
 * reassurance, and a page that labelled every true thing as true would have
 * said nothing by labelling the one thing that is not.
 */
function StoryMeta({ item, match }: { item: NewsItem; match: Match | null }) {
  return (
    <span className="news-lead__meta">
      <span className="news-kind">{labelForStory(item)}</span>
      {match && <span className="muted">{match.competitionName}</span>}
      <span className="muted">{formatShortDate(item.date)}</span>
      {item.outlet && <span className="muted">{item.outlet}</span>}
      {item.confidence && (
        <span className={`tone tone--${toneForConfidence(item.confidence)}`}>
          {RUMOUR_STATUS_LABEL[item.confidence]}
        </span>
      )}
      {item.importance === 3 && <span className="tone tone--warn">Important</span>}
    </span>
  );
}

/**
 * Who wrote it, under the headline, where a paper puts it.
 *
 * Rendered for the lead, a feature and a clipping alike: the whole value of the
 * byline is that a manager learns which reporter is telling him what, and a
 * paper that only printed it on its front page would teach him that about one
 * story in twenty. Nothing at all is printed when nobody filed the story — see
 * `bylineOf`, which is where that rule lives.
 */
function Byline({ item }: { item: NewsItem }) {
  const byline = bylineOf(item);
  if (!byline) return null;
  return <span className="news-byline">{byline}</span>;
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
 *
 * Its head is the story's own mark over the paper's own photograph — the score
 * and the two shirts when it is a result, the two clubs and the date when it is
 * a tie nobody has played, and a drawing from the sheet when it is not a match at
 * all. The photograph is decorative and is never captioned as a picture of the
 * story: nothing in this game is photographed, and a goalmouth standing in for
 * one particular afternoon would be the paper claiming to know something it does
 * not.
 */
export function LeadStory({ item, game }: { item: NewsItem; game: GameState }) {
  const [opening, ...rest] = paragraphsOf(item);
  const result = resultForStory(game.matches, item);
  const fixture = fixtureForStory(game.matches, item);
  const match = result ?? fixture;
  // The first paragraph only reads as a standfirst when there is something
  // underneath it to stand above. Every story the writer produces today is a
  // single paragraph, so the common case is the whole story set at body size
  // rather than one long line blown up to `--fs-lg` and left hanging.
  const leadsOn = rest.length > 0;
  return (
    <article className="news-lead">
      <div className="news-lead__front">
        {match ? (
          <MatchScoreline game={game} match={match} score={Boolean(result)} />
        ) : (
          <NewsPlate plate={plateForStory(item)} className="news-plate--lead" />
        )}
      </div>
      <div className="news-lead__copy">
        <StoryMeta item={item} match={match} />
        <h2 className="news-lead__headline">{item.headline}</h2>
        <Byline item={item} />
        {opening && (
          <p className={leadsOn ? 'news-lead__standfirst' : 'news-lead__body'}>{opening}</p>
        )}
        {rest.map((paragraph, index) => (
          <p className="news-lead__body" key={index}>
            {paragraph}
          </p>
        ))}
        <StoryLinks item={item} game={game} />
        {result && (
          <Button variant="ghost" size="sm" onClick={() => openMatchReport(result.id)}>
            Read the match report
          </Button>
        )}
      </div>
    </article>
  );
}

/**
 * The second tier: a column of its own, with the story's opening line under the
 * headline.
 *
 * A feature is the same sheet of paper as a clipping — the board, the tape and
 * the fraction of a degree off square are all the same ones, because it is the
 * same paper — but twice the width and with the first paragraph of the story
 * showing. That paragraph is the whole difference between a story the page is
 * pointing at and a headline in a list, and it is what makes an issue read as a
 * publication rather than as a grid of links.
 */
export function FeatureStory({ item, game }: { item: NewsItem; game: GameState }) {
  const result = resultForStory(game.matches, item);
  const match = result ?? fixtureForStory(game.matches, item);
  const [opening] = paragraphsOf(item);
  return (
    <details className="news-story news-story--feature">
      <summary>
        <NewsPlate plate={plateForStory(item)} className="news-plate--feature" />
        <span className="news-story__text">
          <StoryMeta item={item} match={match} />
          <span className="news-story__headline">{item.headline}</span>
          <Byline item={item} />
          {opening && <span className="news-story__standfirst">{opening}</span>}
        </span>
      </summary>
      <StoryBody item={item} game={game} result={result} />
    </details>
  );
}

/**
 * A story on the board: the picture, the kind, the headline, and the rest of it.
 *
 * The three story layouts are exported because they read nothing but their props
 * — no store, no career lookup of their own — which is the same split the paper
 * keeps everywhere else and the same one `InboxView` makes for its message log:
 * a layout that can be rendered from an item and a career is a layout that can be
 * checked against a real afternoon rather than against the source that types it.
 * See `newsView.test.ts`.
 */
export function BriefStory({ item, game }: { item: NewsItem; game: GameState }) {
  const result = resultForStory(game.matches, item);
  const match = result ?? fixtureForStory(game.matches, item);
  return (
    <details className="news-story">
      <summary>
        <NewsPlate plate={plateForStory(item)} />
        <span className="news-story__text">
          <StoryMeta item={item} match={match} />
          <span className="news-story__headline">{item.headline}</span>
          <Byline item={item} />
        </span>
      </summary>
      <StoryBody item={item} game={game} result={result} />
    </details>
  );
}

/**
 * The story, opened: the words, who it is about, and the way on.
 *
 * The body is the same whether it was opened on the board or given a column,
 * because it is the same story — and a story about a football match that has been
 * played ends with the door into the report, which is the one thing this screen
 * can offer that the story itself cannot print.
 */
function StoryBody({ item, game, result }: { item: NewsItem; game: GameState; result: Match | null }) {
  return (
    <div className="news-story__body">
      {paragraphsOf(item).map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
      <StoryLinks item={item} game={game} />
      {result && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => openMatchReport(result.id)}>
            Read the match report
          </Button>
        </div>
      )}
    </div>
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

  // The front page, then the next two, then everything else under its own day.
  // The split is the feed's own order — newest first — rather than a second sort,
  // because the order the stories arrived in is the order a manager reads them
  // in, and how much a story matters is already written on the story.
  const [lead, ...afterLead] = shown;
  const features = afterLead.slice(0, FEATURES);
  const briefs = afterLead.slice(FEATURES);
  const dates = Array.from(new Set(briefs.map((item) => item.date)));

  return (
    <div className="stack">
      <PageHeader
        eyebrow="Media"
        title="News"
        /* The board on the dressing-room wall, the same one the club's own 
           noticeboard uses: this is where the week's paper is pinned up. */
        photo="/photos/inbox-noticeboard.webp"
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

            {features.length > 0 && (
              <section className="news-features" aria-label="Also in this issue">
                {features.map((item) => (
                  <FeatureStory key={item.id} item={item} game={game} />
                ))}
              </section>
            )}

            {dates.map((date) => (
              /* A day of the paper is a board with its date pinned to it and the
                 day's clippings under it, rather than a heading over a grid. */
              <section className="news-board" key={date}>
                <h2 className="news-day">{formatDate(date)}</h2>
                <div className="news-feed">
                  {briefs
                    .filter((item) => item.date === date)
                    .map((item) => (
                      <BriefStory key={item.id} item={item} game={game} />
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
