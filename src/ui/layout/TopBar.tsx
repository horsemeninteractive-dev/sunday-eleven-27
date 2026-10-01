import { useMemo, useState } from 'react';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { formatDate, formatDayMonth } from '@/simulation/calendar';
import { isPlayer, type Player } from '@/domain/person';
import { matchVenueLabel } from '@/simulation/queries';
import { nextFixtureFor as scheduleNextFixture } from '@/simulation/schedule';
import type { CommandState } from '../commandState';
import { runCommand } from '../commandActions';
import { clubStyle } from '../colour';
import { gameActions } from '../hooks';
import { ClubBadge } from '../components/Badge';
import { Glyph } from '../components/icons';
import { StripeField } from '../components/StripeField';
import { CompetitionLink, ClubLink } from '../components/Links';
import { UtilityMenu } from './UtilityMenu';

/**
 * The command bar.
 *
 * Football Manager's answer to "what is going on and what do I do next": the
 * club's own colours across the top, the next match in the middle, and one
 * Continue button that always says what it will actually do — move the week on,
 * run the session, or play the match.
 */

function colours(game: GameState): Record<string, string> {
  return clubStyle(game.clubs[game.userClubId]!.identity.colours);
}

/**
 * The next match the club actually has.
 *
 * Read from the calendar rather than from a matchday number: a rearranged game
 * is the next match on its new date, not on the Sunday it was supposed to be.
 */
export function nextFixtureFor(game: GameState): Match | null {
  return scheduleNextFixture(game, game.userClubId, game.date);
}

function NextMatchBlock({ game, command }: { game: GameState; command: CommandState }) {
  const club = game.clubs[game.userClubId]!;
  const fixture = nextFixtureFor(game);
  const isMatchday = command.phase === 'matchday';
  const isToday = isMatchday && fixture?.date === game.date;

  if (!fixture) {
    return (
      <div className="nextmatch">
        <span className="nextmatch__head">
          <span className="nextmatch__label">Next match</span>
          <span className="nextmatch__title">No upcoming match</span>
        </span>
        <span className="nextmatch__meta">
          <span>{game.season.label}</span>
        </span>
      </div>
    );
  }

  const opponentId = fixture.homeClubId === club.id ? fixture.awayClubId : fixture.homeClubId;
  const opponent = game.clubs[opponentId]!;
  const venue = matchVenueLabel(fixture, club.id);
  const ground = game.world.grounds[fixture.groundId];

  return (
    <div className="nextmatch">
      <span className="nextmatch__head">
        <span className="nextmatch__label">{isToday ? 'Matchday' : 'Next match'}</span>
        <span className="nextmatch__title">
          {venue === 'Home' ? 'v ' : 'at '}
          <ClubLink clubId={opponentId}>{opponent.identity.name}</ClubLink>
        </span>
      </span>
      <span className="nextmatch__meta">
        <span>
          <Glyph name="fixtures" /> {formatDayMonth(fixture.date)} · {fixture.kickOff}
        </span>
        <span>
          <Glyph name="league" /> <CompetitionLink>{fixture.competitionName}</CompetitionLink>
        </span>
        <span>
          <Glyph name="world" /> {venue} · {ground?.name ?? 'ground to confirm'}
        </span>
      </span>
    </div>
  );
}

function SearchBox({ game }: { game: GameState }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return { clubs: [], players: [] };
    const clubs = Object.values(game.clubs)
      .filter(
        (club) =>
          club.identity.name.toLowerCase().includes(needle) ||
          club.identity.nickname.toLowerCase().includes(needle) ||
          club.identity.shortName.toLowerCase().includes(needle),
      )
      .slice(0, 5);
    const players = Object.values(game.people)
      .filter(isPlayer)
      .filter((person) =>
        `${person.firstName} ${person.surname} ${person.nickname ?? ''}`.toLowerCase().includes(needle),
      )
      .sort((a, b) => (a.clubId === game.userClubId ? -1 : 1) - (b.clubId === game.userClubId ? -1 : 1))
      .slice(0, 8) as Player[];
    return { clubs, players };
  }, [game, query]);

  const hasResults = results.clubs.length > 0 || results.players.length > 0;

  return (
    <div className="topbar__search">
      <Glyph name="search" className="topbar__search-icon" />
      <input
        type="search"
        value={query}
        placeholder="Search clubs, players…"
        aria-label="Search clubs and players"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && query.trim().length >= 2 && (
        <div className="searchresults" role="listbox" aria-label="Search results">
          {!hasResults && <p className="searchresults__empty">Nothing found for “{query}”.</p>}
          {results.clubs.map((club) => (
            <button
              key={club.id}
              type="button"
              className="searchresults__item"
              onClick={() => {
                gameActions().openProfile({ kind: 'club', id: club.id });
                setQuery('');
                setOpen(false);
              }}
            >
              <span className="searchresults__kind">{club.identity.shortName}</span>
              <span>{club.identity.name}</span>
              <span className="searchresults__kind">Club</span>
            </button>
          ))}
          {results.players.map((player) => (
            <button
              key={player.id}
              type="button"
              className="searchresults__item"
              onClick={() => {
                gameActions().openProfile({ kind: 'player', id: player.id });
                setQuery('');
                setOpen(false);
              }}
            >
              <span className="searchresults__kind">{player.preferredPosition}</span>
              <span>
                {player.firstName} {player.surname}
              </span>
              <span className="searchresults__kind">
                {player.clubId ? game.clubs[player.clubId]?.identity.shortName : 'Unattached'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DesktopTopBar({ game, command }: { game: GameState; command: CommandState }) {
  const club = game.clubs[game.userClubId]!;

  return (
    <header className="topbar on-club" style={colours(game)}>
      <StripeField className="topbar__stripes" pattern="var(--club-stripes)" fade="var(--club-bar-fade)" />
      <div className="topbar__row">
        <button
          type="button"
          className="topbar__club"
          onClick={() => gameActions().openProfile({ kind: 'club', id: club.id })}
          title={`${club.identity.name} — club profile`}
        >
          <span className="topbar__crest">
            <ClubBadge club={club} />
          </span>
          <span className="topbar__names">
            <span className="topbar__club-name">{club.identity.name}</span>
            <span className="topbar__club-sub">{club.identity.nickname}</span>
          </span>
        </button>

        <NextMatchBlock game={game} command={command} />

        <SearchBox game={game} />

        <button
          type="button"
          className="topbar__date"
          onClick={() => runCommand({ kind: 'action', action: 'open-planner' })}
          title="Open the calendar"
        >
          <strong>{formatDate(command.progress.date)}</strong>
          <span>
            {game.season.label} · matchday {command.progress.matchday} of {command.progress.of}
          </span>
        </button>

        <button
          type="button"
          className={`continue-btn${command.urgency === 'now' ? ' continue-btn--solid' : ''}`}
          onClick={() => runCommand(command.action.intent)}
          title={command.action.hint ?? command.action.label}
        >
          {command.action.label}
          <Glyph name="chevron" />
        </button>

        <div className="topbar__tools">
          <UtilityMenu icon />
        </div>
      </div>
    </header>
  );
}

export function MobileTopBar({ game, command }: { game: GameState; command: CommandState }) {
  const club = game.clubs[game.userClubId]!;
  return (
    <header className="mobilebar on-club" style={colours(game)}>
      <StripeField className="mobilebar__stripes" pattern="var(--club-stripes)" fade="var(--club-bar-fade)" />
      <button
        type="button"
        className="mobilebar__club"
        onClick={() => gameActions().openProfile({ kind: 'club', id: club.id })}
      >
        <span className="topbar__crest">
          <ClubBadge club={club} />
        </span>
        <span className="mobilebar__text">
          <strong>{club.identity.shortName}</strong>
          <span className="small" style={{ opacity: 0.75 }}>
            {formatDayMonth(command.progress.date)} · MD {command.progress.matchday}/{command.progress.of}
          </span>
        </span>
      </button>
      <div className="mobilebar__tools">
        <UtilityMenu icon compact />
      </div>
    </header>
  );
}

/** Mobile: the same command state, as a strip above the bottom navigation. */
export function MobileCommandStrip({ command }: { command: CommandState }) {
  return (
    <div className={`mobilecommand mobilecommand--${command.urgency}`}>
      <div className="mobilecommand__now">
        <p className="mobilecommand__eyebrow">{command.eyebrow}</p>
        <p className="mobilecommand__title">{command.title}</p>
      </div>
      <button
        type="button"
        className="btn btn--primary btn--lg mobilecommand__go"
        onClick={() => runCommand(command.action.intent)}
        title={command.action.hint ?? command.action.label}
      >
        {command.action.short}
        <Glyph name="chevron" />
      </button>
    </div>
  );
}
