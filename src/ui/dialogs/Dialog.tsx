import { useEffect, type ReactNode } from 'react';

/**
 * One dialog for everything that is not a screen.
 *
 * Settings, the changelog, the credits and the managers already saved are all
 * the same shape: something the manager asked to see, over whatever he was
 * doing, dismissed the same way. They share the overlay the rest of the game
 * already uses so that a dialog opened from the main menu and one opened
 * mid-season look like the same game.
 */
export function Dialog({
  title,
  subtitle,
  onClose,
  narrow = false,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  narrow?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  // Escape closes it, because that is what Escape means everywhere else here.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title}>
      {/* Clicking the dark outside closes it, but the panel itself does not. */}
      <div className="overlay__scrim" onClick={onClose} aria-hidden="true" />
      <div className={`overlay__panel${narrow ? ' overlay__panel--narrow' : ''}`}>
        <div className="overlay__bar">
          <span className="overlay__title">{title}</span>
          <div className="row row--tight">
            {subtitle && <span className="muted small">{subtitle}</span>}
            <button type="button" className="overlay__close" aria-label="Close" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>
        <div className="overlay__body">{children}</div>
        {footer && <div className="overlay__foot">{footer}</div>}
      </div>
    </div>
  );
}
