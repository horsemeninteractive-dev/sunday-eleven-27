import { useCallback, useEffect, useRef } from 'react';
import { currentMotion } from '@/state/preferences';
import { BrandLockup } from '../components/BrandMark';
import { Button } from '../components/primitives';
import { SceneBackdrop } from '../components/SceneBackdrop';
import { TouchlineLockup } from '../components/TouchlineMark';

/**
 * The first boot: Touchline, and then the game it plays.
 *
 * This is the one screen a new manager sees before the menu, and it exists to
 * say one thing — **Touchline is the football underneath, SE27 is the game** —
 * in the time it takes to read two names. It is a startup sequence rather than a
 * loading screen: nothing is being waited for, the store is already open, and
 * there is nothing on it that could take longer than the animation.
 *
 * It is deliberately not the same thing as the placeholder in `index.html`. That
 * one is a save being opened and a database being read, and it says so; this one
 * is the introduction a manager gets when there was no save to open. Keeping
 * them apart is the point of both of them.
 *
 * The order is the relationship, top to bottom: the engine, then the game built
 * on it, and the last line says so in words. The reveal is staggered on the
 * stylesheet's own timings, but nothing depends on it — with motion reduced, or
 * if the animation never runs at all, every line is simply already in place.
 *
 * It ends on its own, and it can be ended early: the button is a real button, in
 * the tab order, with a name, and Escape does the same thing. Whichever happens,
 * the answer is remembered (see `state/firstBoot`) and the menu takes over.
 */

/** How long the sequence holds before the menu, with motion at full. */
const HOLD_MS = 2900;

/**
 * And with motion reduced.
 *
 * Short, but not zero: the sequence still has to be *read*, and a quarter of a
 * second of two names is a flash rather than an introduction. Nothing is moving
 * in this case, so there is nothing to watch — only the line to take in.
 */
const HOLD_REDUCED_MS = 900;

export function FirstBootView({ onDone }: { onDone: () => void }) {
  // The timer and the button both end it, and so does Escape. They can arrive in
  // the same tick — the button pressed as the timer fires — and the screen is
  // only allowed to hand over once.
  const finished = useRef(false);
  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  }, [onDone]);

  useEffect(() => {
    const hold = currentMotion() === 'reduced' ? HOLD_REDUCED_MS : HOLD_MS;
    const timer = window.setTimeout(finish, hold);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [finish]);

  return (
    <div
      className="firstboot"
      role="group"
      aria-label="Touchline, the match simulation engine, in Sunday Eleven 27"
    >
      {/* The same ground the menu behind it wears, so this reads as the game's
          own front door rather than as something bolted on to it. */}
      <SceneBackdrop />

      <div className="firstboot__stage">
        <section className="firstboot__engine">
          <TouchlineLockup detail="Match Simulation Engine" />
        </section>

        {/* Decoration and marked as such: it points down, and the words either
            side of it already say what it means. */}
        <div className="firstboot__rule" aria-hidden="true" />

        <section className="firstboot__game">
          <BrandLockup />
          <p className="firstboot__tagline">Sunday League Football Management</p>
          <p className="firstboot__powered">Powered by Touchline</p>
        </section>
      </div>

      <div className="firstboot__skip">
        <Button variant="ghost" size="sm" onClick={finish}>
          Skip intro
        </Button>
      </div>
    </div>
  );
}
