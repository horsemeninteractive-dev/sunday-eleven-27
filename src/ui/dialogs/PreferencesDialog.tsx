import { useEffect, useState } from 'react';
import { useGameStore } from '@/state/gameStore';
import {
  currentMotion,
  fullscreenSupported,
  isFullscreen,
  MATCH_SPEEDS,
  setFullscreen,
  watchFullscreen,
  type MotionPreference,
  type RendererPreference,
} from '@/state/preferences';
import { MATCH_RENDERERS } from '@/presentation/matchRenderers';
import { gameActions } from '../hooks';
import { Button, Callout, Panel } from '../components/primitives';
import { Dialog } from './Dialog';

/**
 * How the game behaves for the person playing it.
 *
 * Three things, and all three are real: motion (which the stylesheet acts on
 * through one attribute on the page), fullscreen (which the browser owns, so
 * the switch reflects the truth rather than assuming it), and the speed a match
 * opens at. Nothing here changes the simulation, so nothing here needs a career
 * to exist — the same dialog opens from the menu and from the middle of a season.
 */

const MOTION_OPTIONS: Array<{ value: MotionPreference; label: string; detail: string }> = [
  { value: 'system', label: 'Follow the system', detail: 'The same answer your computer gives every other application.' },
  { value: 'reduced', label: 'Reduced motion', detail: 'No drifting stripes, no settling wordmark, no movement that is only decoration.' },
  { value: 'full', label: 'Full motion', detail: 'The stripe drifts and the menu settles, even if your system asks otherwise.' },
];

export function PreferencesDialog() {
  const preferences = useGameStore((state) => state.preferences);
  const [fullscreen, setFullscreenState] = useState(() => isFullscreen());
  const supported = fullscreenSupported();

  // Fullscreen can be left with Escape or with the browser's own controls, so
  // the switch watches the window rather than trusting what was clicked.
  useEffect(() => watchFullscreen(setFullscreenState), []);

  const changeMotion = (motion: MotionPreference) => gameActions().setPreferences({ motion });

  return (
    <Dialog
      title="Preferences"
      subtitle="These are yours, not your club's"
      narrow
      onClose={() => gameActions().closeDialog()}
      footer={
        <Button variant="ghost" onClick={() => gameActions().resetPreferences()}>
          Reset to defaults
        </Button>
      }
    >
      <div className="stack">
        <Panel title="Motion" subtitle="What the game is allowed to move">
          <div className="choices choices--stacked" role="radiogroup" aria-label="Motion">
            {MOTION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={preferences.motion === option.value}
                className={`choice choice--wide${preferences.motion === option.value ? ' choice--on' : ''}`}
                onClick={() => changeMotion(option.value)}
              >
                <span className="choice__label">{option.label}</span>
                <span className="choice__detail">{option.detail}</span>
              </button>
            ))}
          </div>
          <p className="small muted">
            Currently the game is {currentMotion() === 'reduced' ? 'holding everything still' : 'allowed to move'}.
          </p>
        </Panel>

        <Panel title="Window" subtitle="How much of the screen the game takes">
          {supported ? (
            <div className="pref-row">
              <div>
                <strong>Fullscreen</strong>
                <p className="small muted">Fills the screen and hides the browser. Escape leaves it.</p>
              </div>
              <Button
                variant={fullscreen ? 'primary' : 'default'}
                onClick={() => {
                  void setFullscreen(!fullscreen).then(setFullscreenState);
                }}
              >
                {fullscreen ? 'Leave fullscreen' : 'Go fullscreen'}
              </Button>
            </div>
          ) : (
            <Callout tone="info">This browser will not let a page take the whole screen.</Callout>
          )}
        </Panel>

        <Panel title="Matches" subtitle="The speed a match opens at">
          <div className="choices choices--inline" role="radiogroup" aria-label="Default match speed">
            {MATCH_SPEEDS.map((speed) => (
              <button
                key={speed}
                type="button"
                role="radio"
                aria-checked={preferences.defaultMatchSpeed === speed}
                className={`choice choice--compact${preferences.defaultMatchSpeed === speed ? ' choice--on' : ''}`}
                onClick={() => gameActions().setPreferences({ defaultMatchSpeed: speed })}
              >
                {speed}&times; speed
              </button>
            ))}
          </div>
          <p className="small muted">
            A match can always be slowed down or sped up while it is being played; this is only where it starts.
          </p>
        </Panel>

        <Panel title="Match view" subtitle="How the match is drawn">
          <div className="choices choices--stacked" role="radiogroup" aria-label="Match view">
            {(['2d', '3d'] as RendererPreference[]).map((kind) => {
              const option = MATCH_RENDERERS[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={preferences.renderer === kind}
                  disabled={!option.available}
                  className={`choice choice--wide${preferences.renderer === kind ? ' choice--on' : ''}`}
                  onClick={() => gameActions().setPreferences({ renderer: kind })}
                >
                  <span className="choice__label">
                    {option.label}
                    {option.available ? '' : ' — coming soon'}
                  </span>
                  <span className="choice__detail">{option.description}</span>
                </button>
              );
            })}
          </div>
          <p className="small muted">
            The renderer only draws the match; it never changes it. Choosing a view that is not built yet falls back to the
            2D pitch.
          </p>
        </Panel>
      </div>
    </Dialog>
  );
}
