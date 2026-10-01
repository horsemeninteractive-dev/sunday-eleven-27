import type { ReactNode } from 'react';
import { attributeTone } from '../format';
import { toggleSort, type SortState } from '../tableSort';
import { UIGlyph } from './icons';

/**
 * Small presentational building blocks. No simulation logic lives here.
 *
 * Panels carry a *level* rather than a colour: `primary` is the one decision or
 * fact that matters on the screen, `default` is ordinary supporting content,
 * and `quiet` is history, context or reference material that should recede.
 * Tone communicates status and is orthogonal to level.
 */

export type PanelLevel = 'primary' | 'default' | 'quiet';
export type PanelTone = 'default' | 'warn' | 'danger' | 'accent';

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  tone = 'default',
  level = 'default',
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: PanelTone;
  level?: PanelLevel;
  id?: string;
}) {
  return (
    <section id={id} className={`panel panel--${tone} panel--level-${level}${className ? ` ${className}` : ''}`}>
      {(title || actions) && (
        <header className="panel__head">
          <div className="panel__heading">
            {title && <h2 className="panel__title">{title}</h2>}
            {subtitle && <p className="panel__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="panel__actions">{actions}</div>}
        </header>
      )}
      <div className="panel__body">{children}</div>
    </section>
  );
}

export function Pill({
  children,
  tone = 'default',
  title,
}: {
  children: ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'bad' | 'accent' | 'muted';
  title?: string;
}) {
  return (
    <span className={`pill pill--${tone}`} title={title}>
      {children}
    </span>
  );
}

export function AttributeChip({ label, value, visible = true }: { label: string; value: number; visible?: boolean }) {
  if (!visible) {
    return (
      <span className="attr attr--hidden" title={`${label} is not directly observable`}>
        <span className="attr__label">{label}</span>
        <span className="attr__value">?</span>
      </span>
    );
  }
  return (
    <span className={`attr attr--${attributeTone(value)}`} title={`${label}: ${value}/20`}>
      <span className="attr__label">{label}</span>
      <span className="attr__value">{value}</span>
    </span>
  );
}

/** How a scout would describe a number, rather than the number itself. */
export function attributeWord(value: number): string {
  if (value >= 18) return 'Excellent';
  if (value >= 15) return 'Very good';
  if (value >= 12) return 'Good';
  if (value >= 9) return 'Average';
  if (value >= 6) return 'Poor';
  return 'Awful';
}

/** FM's attribute line: name, the word for it, and a bar. */
export function AttributeRow({ label, value, visible = true }: { label: string; value: number; visible?: boolean }) {
  if (!visible) {
    return (
      <div className="attrrow attrrow--hidden" title={`${label} is not directly observable`}>
        <span className="attrrow__label">{label}</span>
        <span className="attrrow__value muted">—</span>
        <span className="attrrow__bar" />
      </div>
    );
  }
  return (
    <div className={`attrrow attrrow--${attributeTone(value)}`}>
      <span className="attrrow__label">{label}</span>
      <span className={`attrrow__value attr--${attributeTone(value)}`}>{attributeWord(value)}</span>
      <span className="attrrow__bar">
        <span style={{ width: `${Math.max(4, Math.min(100, (value / 20) * 100))}%` }} />
      </span>
    </div>
  );
}

export function Meter({ value, max = 100, tone = 'accent' }: { value: number; max?: number; tone?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <span className={`meter meter--${tone}`}>
      <span className="meter__fill" style={{ width: `${pct}%` }} />
    </span>
  );
}

export function FormPips({ form, limit = 5 }: { form: Array<'W' | 'D' | 'L'>; limit?: number }) {
  const recent = form.slice(-limit);
  if (recent.length === 0) return <span className="muted">No games</span>;
  return (
    <span className="pips" aria-label={`Recent form: ${recent.join(' ')}`}>
      {recent.map((result, index) => (
        <span
          key={`${result}-${index}`}
          className={`pip pip--${result.toLowerCase()}`}
          title={result === 'W' ? 'Won' : result === 'D' ? 'Drew' : 'Lost'}
        >
          {result}
        </span>
      ))}
    </span>
  );
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty">{children}</p>
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled,
  title,
  type = 'button',
  size = 'md',
  block = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
}) {
  return (
    <button
      className={`btn btn--${variant} btn--${size}${block ? ' btn--block' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      type={type}
    >
      {children}
    </button>
  );
}

/**
 * A column heading that sorts the table underneath it.
 *
 * The whole cell is the target rather than just the word, because these tables
 * are read on phones as often as on laptops. One tap sorts by the column, a
 * second reverses it, a third hands the rows back to the screen — and the mark
 * beside the word says which of the three the table is doing.
 */
export function SortTh<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  className,
  title,
}: {
  label: ReactNode;
  sortKey: K;
  sort: SortState<K>;
  onSort: (next: SortState<K>) => void;
  className?: string;
  title?: string;
}) {
  const direction = sort.key === sortKey ? sort.direction : null;
  return (
    <th
      className={`th--sort${direction ? ' th--sorted' : ''}${className ? ` ${className}` : ''}`}
      aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
    >
      <button
        type="button"
        className="th__sort"
        onClick={() => onSort(toggleSort(sort, sortKey))}
        title={title ?? (typeof label === 'string' ? `Sort by ${label.toLowerCase()}` : 'Sort by this column')}
      >
        {label}
        <UIGlyph
          name={direction === 'asc' ? 'sort-asc' : direction === 'desc' ? 'sort-desc' : 'sort-none'}
          className="th__mark"
        />
      </button>
    </th>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  return (
    <div className="stat" title={hint}>
      <span className="stat__label">{label}</span>
      <span className={`stat__value${tone ? ` tone tone--${tone}` : ''}`}>{value}</span>
    </div>
  );
}

export function ToneText({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'muted'; children: ReactNode }) {
  return <span className={`tone tone--${tone}`}>{children}</span>;
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  meta,
  tone = 'default',
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  tone?: PanelTone;
}) {
  return (
    <header className={`page-head page-head--${tone}`}>
      <div className="page-head__text">
        {eyebrow && <p className="page-head__eyebrow">{eyebrow}</p>}
        <h1 className="page-head__title">{title}</h1>
        {subtitle && <p className="page-head__subtitle">{subtitle}</p>}
        {meta && <div className="page-head__meta">{meta}</div>}
      </div>
      {actions && <div className="page-head__actions">{actions}</div>}
    </header>
  );
}

/** A quiet inline notice. Used for warnings and confirmations inside a screen. */
export function Callout({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'warn' | 'bad' | 'ok';
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`callout callout--${tone}`} role={tone === 'bad' ? 'alert' : undefined}>
      <div>
        {title && <strong className="callout__title">{title}</strong>}
        {children}
      </div>
      {action && <div className="callout__action">{action}</div>}
    </div>
  );
}

/** A label/value line that stacks cleanly on narrow screens. */
export function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="facts__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
