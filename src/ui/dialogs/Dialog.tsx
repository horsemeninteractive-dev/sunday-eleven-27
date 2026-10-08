import { useId, useRef, type ReactNode } from 'react';
import { useGameStore } from '@/state/gameStore';
import { Button } from '../components/primitives';
import { useModalTarget, useModal } from '../components/useModal';

/**
 * What kind of thing a dialog is holding.
 *
 * The mechanics are one system and are not up for variation — the scrim, the
 * escape key, the focus trap, where focus lands when it closes. What is *in* the
 * dialog is not one thing, though, and a person's dossier, the club's own page,
 * a match report and a question with two answers were all arriving with the same
 * head on them, which is why they read as the same pop-up with different words.
 * The kind is put on the overlay as `data-modal` and the stylesheet paints it;
 * no dialog behaves differently because of it.
 */
export type DialogKind = 'person' | 'club' | 'report' | 'confirm';

/** Contextual information over the current screen, never a second application. */
export function Dialog({
  title, subtitle, onClose, narrow = false, children, footer, actions, className = '', kind,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  narrow?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Left off for the plain dialog, which is what a utility is. */
  kind?: DialogKind;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const error = useGameStore((state) => state.error);
  const top = useModalTarget();
  useModal(ref, onClose);
  return (
    <div className={`overlay ${className}`} data-modal={kind}>
      <div className="overlay__scrim" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={`overlay__panel${narrow ? ' overlay__panel--narrow' : ''}`}>
        <header className="overlay__bar">
          <div className="overlay__heading">
            <h2 id={titleId} className="overlay__title">{title}</h2>
            {subtitle && <p className="muted small">{subtitle}</p>}
          </div>
          <div className="row row--tight">
            {actions}
            <button type="button" className="overlay__close" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>✕</button>
          </div>
        </header>
        <div className="overlay__body" tabIndex={0} role="region" aria-label={`${title} content`}>{error && top === ref.current && <div className="callout callout--bad" role="alert"><span>{error}</span><Button variant="ghost" size="sm" onClick={() => useGameStore.setState({ error: null })}>Dismiss</Button></div>}{children}</div>
        {footer && <footer className="overlay__foot">{footer}</footer>}
      </div>
    </div>
  );
}
