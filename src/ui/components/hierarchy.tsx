import type { ReactNode } from 'react';

/**
 * The information vocabulary.
 *
 * A management screen is read in three passes, so the UI is built from three
 * kinds of thing:
 *
 *   Section    groups related content under a label. It is a heading and a
 *              body, not a bordered card, and it never carries explanatory
 *              prose — if a group needs a sentence to be understood, the
 *              grouping is wrong.
 *   Tile       one compact fact, action, status or entity. A tile is scanned in
 *              a couple of seconds: a micro-label, a value or a name, and
 *              usually a status or an action.
 *   Panel      the existing component, reserved for genuinely complex content —
 *              a table, a form, a fixture list — where a tile would not fit.
 *
 * Tiles are an information architecture, not a visual gimmick: an important
 * number becomes a tile because it is important, not because everything is a
 * card. The rule of thumb is the one the screens follow — every screen has a
 * primary thing to deal with, some secondary context, and the rest is a door.
 */

export type TileTone = 'default' | 'ok' | 'warn' | 'bad' | 'accent' | 'muted' | 'info';

/** A titled group. No subtitle, no prose: the label is the explanation. */
export function Section({
  title,
  action,
  children,
  className,
  id,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`section${className ? ` ${className}` : ''}`}>
      {(title || action) && (
        <header className="section__head">
          {title && <h2 className="section__title">{title}</h2>}
          {action && <div className="section__action">{action}</div>}
        </header>
      )}
      <div className="section__body">{children}</div>
    </section>
  );
}

/** A responsive grid of tiles. `min` is the narrowest a tile may get. */
export function TileGrid({
  children,
  min = 210,
  className,
}: {
  children: ReactNode;
  min?: number;
  className?: string;
}) {
  return (
    <div className={`tile-grid${className ? ` ${className}` : ''}`} style={{ ['--tile-min' as string]: `${min}px` }}>
      {children}
    </div>
  );
}

/**
 * The base tile: a micro-label, a body and an optional footer of actions.
 *
 * `onClick` turns the whole tile into a button — a tile that opens something
 * should look pressable, not hide the affordance in a link buried in the text.
 */
export function Tile({
  label,
  tone = 'default',
  level = 'default',
  children,
  footer,
  onClick,
  selected = false,
  className,
  title,
}: {
  label?: ReactNode;
  tone?: TileTone;
  level?: 'primary' | 'default' | 'quiet';
  children: ReactNode;
  footer?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
  title?: string;
}) {
  const classes = [
    'tile',
    `tile--${tone}`,
    `tile--level-${level}`,
    onClick ? 'tile--pressable' : '',
    selected ? 'tile--selected' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const inner = (
    <>
      {label && <span className="tile__label">{label}</span>}
      <div className="tile__body">{children}</div>
      {footer && <div className="tile__footer">{footer}</div>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} title={title}>
        {inner}
      </button>
    );
  }
  return (
    <div className={classes} title={title}>
      {inner}
    </div>
  );
}

/** A number that matters, with its label above and an optional note below. */
export function MetricTile({
  label,
  value,
  note,
  tone = 'default',
  children,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  tone?: TileTone;
  children?: ReactNode;
}) {
  return (
    <Tile label={label} tone={tone} className="metric-tile">
      <span className="metric__value">{value}</span>
      {note && <span className="metric__note">{note}</span>}
      {children}
    </Tile>
  );
}

/**
 * The next thing the manager can do, drawn as a tile.
 *
 * The label states the intent ("Team selection"), the title is the object it
 * acts on, and `meta` is the one line of context that decides whether to open
 * it. A disabled tile says why rather than going silently grey.
 */
export function ActionTile({
  label,
  title,
  meta,
  onClick,
  disabled = false,
  tone = 'default',
  primary = false,
  titleText,
}: {
  label: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: TileTone;
  primary?: boolean;
  titleText?: string;
}) {
  return (
    <button
      type="button"
      className={`tile tile--${tone} tile--pressable action-tile${primary ? ' action-tile--primary' : ''}${disabled ? ' tile--disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={titleText}
    >
      <span className="tile__label">{label}</span>
      <span className="action-tile__title">{title}</span>
      {meta && <span className="action-tile__meta">{meta}</span>}
    </button>
  );
}

/** A status with a label: availability, a warning, a state of play. */
export function StatusTile({
  label,
  status,
  note,
  tone = 'default',
}: {
  label: ReactNode;
  status: ReactNode;
  note?: ReactNode;
  tone?: TileTone;
}) {
  return (
    <Tile label={label} tone={tone} className="metric-tile">
      <span className={`status-tile__status tone tone--${tone === 'default' ? 'muted' : tone}`}>{status}</span>
      {note && <span className="status-tile__note">{note}</span>}
    </Tile>
  );
}

/** A fixture: who, where, when, and — once played — how it went. */
export function FixtureTile({
  date,
  opponent,
  venue,
  time,
  outcome,
  score,
  action,
  onAction,
  next = false,
}: {
  date: ReactNode;
  opponent: ReactNode;
  venue: 'H' | 'A' | string;
  time?: ReactNode;
  outcome?: 'W' | 'D' | 'L';
  score?: ReactNode;
  action?: ReactNode;
  onAction?: () => void;
  next?: boolean;
}) {
  return (
    <Tile
      label={date}
      level={next ? 'primary' : 'default'}
      tone={outcome ? (outcome === 'W' ? 'ok' : outcome === 'L' ? 'bad' : 'muted') : 'default'}
      className="fixture-tile"
      footer={
        action && (
          <button type="button" className="btn btn--sm btn--default" onClick={onAction}>
            {action}
          </button>
        )
      }
    >
      <span className="fixture-tile__opponent">{opponent}</span>
      <span className="fixture-tile__meta">
        <span className="fixture-tile__venue">{venue === 'H' ? 'HOME' : venue === 'A' ? 'AWAY' : venue}</span>
        {time && <span className="fixture-tile__time">{time}</span>}
        {score && <span className="fixture-tile__score">{score}</span>}
        {outcome && <span className={`fixture-tile__outcome tone tone--${outcome === 'W' ? 'ok' : outcome === 'L' ? 'bad' : 'muted'}`}>{outcome}</span>}
      </span>
    </Tile>
  );
}

/** A player, scannable at a glance: who, where, how fit, how in form. */
export function PlayerTile({
  name,
  position,
  availability,
  condition,
  form,
  secondary,
  onClick,
  selected = false,
  captain = false,
  tone = 'default',
}: {
  name: ReactNode;
  position: ReactNode;
  availability?: ReactNode;
  condition?: ReactNode;
  form?: ReactNode;
  secondary?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  captain?: boolean;
  tone?: TileTone;
}) {
  return (
    <Tile
      onClick={onClick}
      selected={selected}
      tone={tone}
      level="default"
      className="player-tile"
    >
      <span className="player-tile__top">
        <span className="player-tile__name">
          {name}
          {captain && <span className="player-tile__armband" title="Captain">C</span>}
        </span>
        <span className="player-tile__position">{position}</span>
      </span>
      <span className="player-tile__row">
        {availability && <span className="player-tile__availability">{availability}</span>}
        {condition && <span className="player-tile__chip">{condition}</span>}
        {form && <span className="player-tile__chip">{form}</span>}
      </span>
      {secondary && <span className="player-tile__secondary">{secondary}</span>}
    </Tile>
  );
}

/** A single news item: category, headline, and just enough to know if it matters. */
export function NewsTile({
  category,
  headline,
  summary,
  date,
  tone = 'default',
  onClick,
}: {
  category: ReactNode;
  headline: ReactNode;
  summary?: ReactNode;
  date?: ReactNode;
  tone?: TileTone;
  onClick?: () => void;
}) {
  return (
    <Tile
      label={
        <span className="news-tile__meta">
          <span className={`news-tile__category tone tone--${tone === 'default' ? 'muted' : tone}`}>{category}</span>
          {date && <span className="muted">{date}</span>}
        </span>
      }
      onClick={onClick}
      className="news-tile"
    >
      <span className="news-tile__headline">{headline}</span>
      {summary && <span className="news-tile__summary">{summary}</span>}
    </Tile>
  );
}
