import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { formatDate, formatDayMonth, formatKickOff } from '@/simulation/calendar';
import { isPlayer, type Player } from '@/domain/person';
import { matchVenueLabel } from '@/simulation/queries';
import { nextFixtureFor as scheduleNextFixture } from '@/simulation/schedule';
import type { CommandState } from '../commandState';
import { runCommand } from '../commandActions';
import { gameActions, useClubColours } from '../hooks';
import { ClubBadge } from '../components/Badge';
import { Glyph } from '../components/icons';
import { StripeField } from '../components/StripeField';
import { CompetitionLink, ClubLink } from '../components/Links';
import { Portrait } from '../components/Portrait';
import { UtilityMenu } from './UtilityMenu';
import { Dialog } from '../dialogs/Dialog';

/**
 * The command bar.
 *
 * Football Manager's answer to "what is going on and what do I do next": the
 * club's own colours across the top, the next match in the middle, and one
 * Continue button that always says what it will actually do — move the week on,
 * run the session, or play the match.
 */

/**
 * The club's colours, resolved for the theme in force.
 *
 * The bar is painted flat in the club's colour and read over its own stripes,
 * which is the same in either theme — but one of the tokens is not: the club's
 * *text* ink is mixed against the surface it will be written on, and the panel
 * under a link is a different colour with the lights on.
 */
function useColours(game: GameState): Record<string, string> {
  return useClubColours(game.clubs[game.userClubId]!.identity.colours);
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

  if (command.phase === 'between-jobs') {
    return (
      <div className="nextmatch">
        <span className="nextmatch__head">
          <span className="nextmatch__label">Between jobs</span>
          <span className="nextmatch__title">Looking for a club</span>
        </span>
        <span className="nextmatch__meta">
          <span>{game.season.label}</span>
        </span>
      </div>
    );
  }
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
          <Glyph name="fixtures" /> {formatDayMonth(fixture.date)} · {formatKickOff(fixture.kickOff)}
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

/**
 * Finding somebody without leaving the keyboard.
 *
 * `Ctrl`/`Cmd`+`K` is the shortcut every desktop player already has in their
 * fingers from other applications, and this game has one search worth reaching
 * for: the command bar's. Two things are on the screen and only one of them is
 * ever visible — the desktop bar and, on a phone, the bar's own search dialog —
 * so the shortcut belongs to whichever control is actually laid out, which is
 * what `offsetParent` answers (`null` under a `display: none` shell). Both
 * halves register their own listener for that reason, and neither has to know
 * about a breakpoint width.
 */
function isSearchShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k';
}

function isOnScreen(element: HTMLElement | null): boolean {
  return !!element && element.offsetParent !== null;
}

/** The key the manager's own machine would print on a key cap. */
export function searchShortcutLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl K';
  const platform = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
  return /mac|iphone|ipad|ipod/i.test(platform) ? '\u2318K' : 'Ctrl K';
}

function SearchBox({ game, onChoose }: { game: GameState; onChoose?: () => void }) {
  const resultId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event) || !isOnScreen(input.current)) return;
      event.preventDefault();
      input.current!.focus();
      input.current!.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

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
    <div className="topbar__search" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } if (event.key === 'ArrowDown') { const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.searchresults__item')]; const index = buttons.indexOf(document.activeElement as HTMLButtonElement); if (buttons.length) { event.preventDefault(); buttons[(index + 1) % buttons.length]?.focus(); } } }}>
      <Glyph name="search" className="topbar__search-icon" />
      <input
        ref={input}
        type="search"
        value={query}
        placeholder="Search clubs, players…"
        aria-label="Search clubs and players"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        aria-controls={open && query.trim().length >= 2 ? resultId : undefined}
      />
      {/* The shortcut is written where the shortcut is used: a key nobody knows
          about is a key nobody presses. */}
      <kbd className="topbar__search-key">{searchShortcutLabel()}</kbd>
      {open && query.trim().length >= 2 && (
        <div className="searchresults" id={resultId} role="region" aria-label="Search results">
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
                onChoose?.();
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
                onChoose?.();
              }}
            >
              {/* Drawn, and not a second link: the row is already the door, and a
                  button inside a button is not a thing a browser will draw. This
                  is the one place in the game where a manager finds a man by
                  knowing only his name, so it is the last place that should show
                  him as a string. */}
              <Portrait person={player} />
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
  const betweenJobs = command.phase === 'between-jobs';
  const colours = useColours(game);

  return (
    <header className="topbar on-club" style={colours}>
      <StripeField className="topbar__stripes" pattern="var(--club-stripes)" fade="var(--club-bar-fade)" />
      <div className="topbar__row">
        {betweenJobs ? (
          <span className="topbar__club topbar__club--static">
            <span className="topbar__names">
              <span className="topbar__club-name">Between jobs</span>
              <span className="topbar__club-sub">Looking for a club</span>
            </span>
          </span>
        ) : (
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
        )}

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
  const [searchOpen, setSearchOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const club = game.clubs[game.userClubId]!;
  const betweenJobs = command.phase === 'between-jobs';
  const colours = useColours(game);

  // The phone's half of the same shortcut: the desktop bar is not laid out here,
  // so this is the one that answers, and it opens the dialog rather than an
  // input it has not got.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event) || !isOnScreen(searchButton.current)) return;
      event.preventDefault();
      setSearchOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="mobilebar on-club" style={colours}>
      <StripeField className="mobilebar__stripes" pattern="var(--club-stripes)" fade="var(--club-bar-fade)" />
      <button
        type="button"
        className="mobilebar__club"
        disabled={betweenJobs}
        onClick={() => !betweenJobs && gameActions().openProfile({ kind: 'club', id: club.id })}
      >
        <span className="topbar__crest">
          {betweenJobs ? null : <ClubBadge club={club} />}
        </span>
        <span className="mobilebar__text">
          <strong>{betweenJobs ? 'Between jobs' : club.identity.shortName}</strong>
          {/* Quieter than the club's short name by its size alone: an opacity
              here would be the club's ink mixed with the club's colour, which
              is a smaller amount of the same text rather than a quieter one. */}
          <span className="small">
            {formatDayMonth(command.progress.date)} · MD {command.progress.matchday}/{command.progress.of}
          </span>
        </span>
      </button>
      <div className="mobilebar__tools">
        <button ref={searchButton} type="button" className="topbar__icon" aria-label="Find a club or player" onClick={() => setSearchOpen(true)}><Glyph name="search" /></button>
        <UtilityMenu icon compact />
      </div>
      {searchOpen && <Dialog title="Find a club or player" narrow onClose={() => setSearchOpen(false)}><SearchBox game={game} onChoose={() => setSearchOpen(false)} /><p className="small muted">Type at least two letters. Use Tab or the down arrow to reach results.</p></Dialog>}
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
