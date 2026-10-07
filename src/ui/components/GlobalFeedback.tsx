import { useGameStore } from '@/state/gameStore';
import { Button } from './primitives';
import { createPortal } from 'react-dom';
import { useModalTarget } from './useModal';

/** UI-only dismissal; no durable career state is changed. */
export function GlobalFeedback() {
  const error = useGameStore((state) => state.error);
  const top = useModalTarget();
  if (!error || top?.classList.contains('overlay__panel') && !top.classList.contains('processing')) return null;
  const feedback = <aside className="banner banner--error global-feedback" role="alert">
    <span>{error}</span>
    <Button variant="ghost" size="sm" ariaLabel="Dismiss error" onClick={() => useGameStore.setState({ error: null })}>Dismiss</Button>
  </aside>;
  return top ? createPortal(feedback, top) : feedback;
}
