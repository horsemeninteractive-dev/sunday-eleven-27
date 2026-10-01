import type { GameState } from '@/domain/game';
import type { ViewId } from '@/state/gameStore';
import { formatDate } from '@/simulation/calendar';
import { currentMatchday, formOf, leaguePosition } from '@/simulation/queries';
import type { CommandState } from '../commandState';
import { runCommand } from '../commandActions';
import { clubStyle } from '../colour';
import { ClubBadge } from '../components/Badge';
import { Glyph } from '../components/icons';
import { Button, FormPips } from '../components/primitives';
import { UtilityMenu } from './UtilityMenu';

/** The club's colours, resolved for this game. */
function colours(game: GameState): Record<string, string> {
  return clubStyle(game.clubs[game.userClubId]!.identity.colours);
}

function ClubIdentity({ game, onNavigate }: { game: GameState; onNavigate: (view: ViewId) => void }) {
  const club = game.clubs[game.userClubId]!;
  const manager = game.people[club.managerId ?? ''];
  const ground = game.world.grounds[club.groundId];
  const isPlayerManager = club.managerId === game.userClubId || manager?.kind === 'player';
  return (
    <button type="button" className="clubmark" onClick={() => onNavigate('dashboard')} title="Back to the overview">
      <span className="clubmark__crest">
        <ClubBadge club={club} size={34} />
      </span>
      <span className="clubmark__text">
        <strong className="clubmark__name">{club.identity.name}</strong>
        <span className="clubmark__sub">
          {club.identity.nickname}
          {ground ? ` · ${ground.name}` : ''} · {isPlayerManager ? 'you pick yourself' : `managed by ${manager ? `${manager.firstName} ${manager.surname}` : 'nobody'}`}
        </span>
      </span>
    </button>
  );
}

function ProgressMeta({ game }: { game: GameState }) {
  const club = game.clubs[game.userClubId]!;
  const position = leaguePosition(game, club.id);
  return (
    <dl className="topbar__meta">
      <div className="topbar__fact">
        <dt>Date</dt>
        <dd>{formatDate(game.date)}</dd>
      </div>
      <div className="topbar__fact">
        <dt>{game.season.label}</dt>
        <dd>
          Matchday {Math.min(currentMatchday(game), Math.max(game.season.calendar.length, 1))} of{' '}
          {game.season.calendar.length}
        </dd>
      </div>
      <div className="topbar__fact">
        <dt>League</dt>
        <dd>{position ? `${position}${ordinalSuffix(position)}` : '—'}</dd>
      </div>
      <div className="topbar__fact topbar__fact--form">
        <dt>Form</dt>
        <dd>
          <FormPips form={formOf(game, club.id)} />
        </dd>
      </div>
    </dl>
  );
}

/**
 * The persistent command bar. It always carries the current phase and the next
 * meaningful action, so nobody has to go looking for "play match" or "advance
 * the week" on a dashboard panel.
 */
export function DesktopHeader({
  game,
  command,
  onNavigate,
}: {
  game: GameState;
  command: CommandState;
  onNavigate: (view: ViewId) => void;
}) {
  return (
    <header className="topbar" style={colours(game)}>
      <div className="topbar__row">
        <ClubIdentity game={game} onNavigate={onNavigate} />
        <ProgressMeta game={game} />
        <div className="topbar__tools">
          <UtilityMenu />
        </div>
      </div>
      <CommandBarRow command={command} />
    </header>
  );
}

export function CommandBarRow({ command, compact = false }: { command: CommandState; compact?: boolean }) {
  return (
    <div className={`commandbar commandbar--${command.urgency}${compact ? ' commandbar--compact' : ''}`}>
      <div className="commandbar__now">
        <p className="commandbar__eyebrow">
          <span className={`commandbar__pulse commandbar__pulse--${command.phase}`} aria-hidden="true" />
          {command.eyebrow}
        </p>
        <p className="commandbar__title">{command.title}</p>
        <p className="commandbar__lines">{command.lines.filter(Boolean).join(' · ')}</p>
        {command.detail && !compact && <p className="commandbar__detail">{command.detail}</p>}
      </div>
      <div className="commandbar__actions">
        <Button variant="primary" size={compact ? 'md' : 'lg'} onClick={() => runCommand(command.action.intent)} title={command.action.hint}>
          {compact ? command.action.short : command.action.label}
        </Button>
        {!compact &&
          command.secondary.map((action) => (
            <Button
              key={action.label}
              variant={action.variant === 'quiet' ? 'ghost' : 'default'}
              size="md"
              onClick={() => runCommand(action.intent)}
              title={action.hint}
            >
              {action.label}
            </Button>
          ))}
      </div>
    </div>
  );
}

/** Mobile: identity and the week's date on top, the action at the bottom. */
export function MobileHeader({ game, onNavigate }: { game: GameState; onNavigate: (view: ViewId) => void }) {
  const club = game.clubs[game.userClubId]!;
  const position = leaguePosition(game, club.id);
  return (
    <header className="mobilebar" style={colours(game)}>
      <button type="button" className="mobilebar__club" onClick={() => onNavigate('dashboard')}>
        <span className="clubmark__crest clubmark__crest--sm">
          <ClubBadge club={club} size={22} />
        </span>
        <span className="mobilebar__text">
          <strong>{club.identity.shortName}</strong>
          <span className="muted small">
            {formatDate(game.date)} · {position ? `${position}${ordinalSuffix(position)}` : '—'}
          </span>
        </span>
      </button>
      <div className="mobilebar__tools">
        <UtilityMenu compact />
      </div>
    </header>
  );
}

/** The mobile equivalent of the command bar: same state, same source of truth. */
export function MobileCommandStrip({ command }: { command: CommandState }) {
  return (
    <div className={`mobilecommand mobilecommand--${command.urgency}`}>
      <div className="mobilecommand__now">
        <p className="mobilecommand__eyebrow">{command.eyebrow}</p>
        <p className="mobilecommand__title">{command.title}</p>
      </div>
      <button
        type="button"
        className="btn btn--primary btn--md mobilecommand__go"
        onClick={() => runCommand(command.action.intent)}
        title={command.action.hint}
      >
        <Glyph name="match" />
        <span>{command.action.short}</span>
      </button>
    </div>
  );
}

function ordinalSuffix(position: number): string {
  const remainder = position % 100;
  if (remainder >= 11 && remainder <= 13) return 'th';
  switch (position % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}
