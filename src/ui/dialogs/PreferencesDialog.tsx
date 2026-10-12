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
  type ThemePreference,
} from '@/state/preferences';
import { MATCH_RENDERERS } from '@/presentation/matchRenderers';
import { gameActions, useTheme } from '../hooks';
import { Button, Callout, Panel } from '../components/primitives';
import { Tabs } from '../components/Tabs';
import { Dialog } from './Dialog';

/**
 * How the game behaves for the person playing it.
 *
 * Five things, and all five are real: the lights (which the stylesheet acts on
 * through one attribute on the page), motion (the same arrangement, a second
 * attribute), fullscreen (which the browser owns, so the switch reflects the
 * truth rather than assuming it), and the two things about a match that are
 * about watching rather than playing — the speed it opens at and how it is
 * drawn. Nothing here changes the simulation, so nothing here needs a career to
 * exist: the same dialog opens from the menu and from the middle of a season.
 *
 * They are grouped into three tabs because they answer three different
 * questions — what this screen looks like, what a match looks like, and how much
 * window the game takes — and because a settings dialog is read rather than
 * browsed: four headings in one column is a page to be scanned, and three named
 * places are three places to look in. The tabstrip is the game's own
 * (`components/Tabs`), so the keys, the roles and the focus are the same as
 * every other tabbed surface in the app.
 */

type PreferencesTab = 'appearance' | 'matches' | 'window';

const TABS: Array<{ value: PreferencesTab; label: string }> = [
  { value: 'appearance', label: 'Appearance' },
  { value: 'matches', label: 'Matches' },
  { value: 'window', label: 'Window' },
];

const MOTION_OPTIONS: Array<{ value: MotionPreference; label: string; detail: string }> = [
  { value: 'system', label: 'Follow the system', detail: 'The same answer your computer gives every other application.' },
  { value: 'reduced', label: 'Reduced motion', detail: 'No drifting stripes, no settling wordmark, no movement that is only decoration.' },
  { value: 'full', label: 'Full motion', detail: 'The stripe drifts and the menu settles, even if your system asks otherwise.' },
];

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

/**
 * Which way it ended up, said out loud.
 *
 * The choice and the answer are two different things, and "System" is the one
 * answer that can change while the manager is playing — so the sentence says
 * which of the two decided it rather than only what the result is. A pure
 * function rather than an expression in the markup because it is the one piece
 * of this dialog’s copy with a rule to it: the words printed here are the only
 * place a manager is told that his machine was consulted.
 */
export function lightsNote(preference: ThemePreference, theme: 'dark' | 'light'): string {
  const lights = theme === 'light' ? 'on' : 'off';
  return preference === 'system'
    ? `Following your system, so the lights are ${lights}.`
    : `The lights are ${lights}.`;
}

export function PreferencesDialog() {
  const preferences = useGameStore((state) => state.preferences);
  const [tab, setTab] = useState<PreferencesTab>('appearance');
  const [fullscreen, setFullscreenState] = useState(() => isFullscreen());
  const supported = fullscreenSupported();
  // The lights the game is actually drawn in, which is the manager's own choice
  // or his system's — the same resolution the stylesheet is given, read here so
  // that the sentence under the switch can say which of the two it was.
  const theme = useTheme();

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
      <Tabs label="Preferences" options={TABS} value={tab} onChange={setTab}>
        {tab === 'appearance' ? (
          <div className="stack">
            <Panel title="Lights" subtitle="Which way the game is drawn">
              <div className="choices choices--inline" role="group" aria-label="Theme">
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={preferences.theme === option.value}
                    className={`choice choice--compact${preferences.theme === option.value ? ' choice--on' : ''}`}
                    onClick={() => gameActions().setPreferences({ theme: option.value })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="small muted">
                {lightsNote(preferences.theme, theme)} A match, a pitch and a photograph are drawn the same way in both:
                only the game around them changes.
              </p>
            </Panel>

            <Panel title="Motion" subtitle="What the game is allowed to move">
              <div className="choices choices--stacked" role="group" aria-label="Motion">
                {MOTION_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={preferences.motion === option.value}
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
          </div>
        ) : null}

        {tab === 'matches' ? (
          <div className="stack">
            <Panel title="Matches" subtitle="The speed a match opens at">
              <div className="choices choices--inline" role="group" aria-label="Default match speed">
                {MATCH_SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    aria-pressed={preferences.defaultMatchSpeed === speed}
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
              <div className="choices choices--stacked" role="group" aria-label="Match view">
                {(['2d', '3d'] as RendererPreference[]).map((kind) => {
                  const option = MATCH_RENDERERS[kind];
                  return (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={preferences.renderer === kind}
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
        ) : null}

        {tab === 'window' ? (
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
        ) : null}
      </Tabs>
    </Dialog>
  );
}
