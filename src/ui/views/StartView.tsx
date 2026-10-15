import { Fragment, useEffect, useState, type CSSProperties } from 'react';
import { DEFAULT_PYRAMID } from '@/domain/competition';
import { formatShortDate } from '@/simulation/calendar';
import { orderSaves, type SaveSlotInfo } from '@/state/persistence';
import { useGameStore } from '@/state/gameStore';
import { versionLabel } from '@/version';
import { gameActions } from '../hooks';
import { Button } from '../components/primitives';
import { CareerImportConfirm, ImportCareerButton } from '../components/CareerFile';
import { DeleteSaveButton } from '../components/DeleteSave';
import { BrandLockup } from '../components/BrandMark';
import { InstallCard } from '../components/InstallCard';
import { SceneBackdrop } from '../components/SceneBackdrop';
import { Glyph } from '../components/icons';
import { loadCareer } from '../careerActions';

/** The line under the mark, one word per span so it can be spread. */
const TAGLINE = ['Sunday', 'League', 'Management'];

/**
 * The things that belong to the game rather than to any career.
 *
 * They are kept to one row under the ways in: a new manager needs the two doors
 * and nothing else, and a returning one wants them out of the way but to hand.
 */
const UTILITIES: Array<{ id: 'preferences' | 'profiles' | 'changelog' | 'credits'; label: string; detail: string }> = [
  { id: 'preferences', label: 'Preferences', detail: 'Motion, fullscreen and how a match opens' },
  { id: 'profiles', label: 'Managers', detail: 'Profiles you have already used' },
  { id: 'changelog', label: 'Changelog', detail: 'What has changed, and what this build is' },
  { id: 'credits', label: 'Credits', detail: 'What the game is built with and from' },
];

/**
 * The way in.
 *
 * A scene rather than a form: a Sunday league ground washed green behind the
 * game's mark on the left, and the two ways to begin beside it — take over a
 * club that already exists, or build one of your own — with the careers already
 * saved underneath. Nothing here tries to sell the game to the person who
 * already owns it.
 */
export function StartView() {
  // Listed when the screen appears, not when it is built: the list comes from the
  // database, which is a promise rather than a value, so there is nothing to
  // read synchronously. The store is already open by now — the menu is only
  // reached once it is — so this resolves on the next tick rather than showing
  // an empty list first.
  const [saves, setSaves] = useState<SaveSlotInfo[]>([]);
  const [reading, setReading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * What went wrong before the menu could be drawn, if anything.
   *
   * It is read from the store rather than decided here because it is known
   * before this screen is built — at boot, when the career that would have been
   * reopened would not open. A browser whose storage could not be read looks
   * exactly like a browser with nothing saved, and those two must never be
   * presented as the same thing: one of them is a manager's whole season.
   */
  const bootError = useGameStore((state) => state.bootError);

  /**
   * Read the list of careers, and say whether anything came back.
   *
   * The two callers want different things from one read. Refresh is asked for,
   * so it says it is reading while it does; a career that has just been deleted
   * changes one row of a list the manager is already reading, and a list that
   * vanished and came back would be the page announcing something it had already
   * shown him. The read on the way in has nothing on the screen to contradict
   * either, which is why `reading` starts true.
   */
  const readSaves = () => {
    setFailure(null);
    return gameActions().listSaves()
      .then((listed) => setSaves(orderSaves(listed)))
      .catch(() => setFailure('Your saved careers could not be listed. Try Refresh.'))
      .finally(() => setReading(false));
  };

  const refreshSaves = () => {
    setReading(true);
    void readSaves();
  };

  useEffect(() => { void readSaves(); }, []);

  return (
    <div className="start">
      <SceneBackdrop />

      <div className="start__shell">
        <section className="start__brand">
          <div className="lockup">
            <BrandLockup />
            {/* The words are spread across the mark's width, so they are set as
                words rather than as one line — with the spaces kept in the
                markup, so it still reads as three words out loud. */}
            <p className="start__tagline">
              {TAGLINE.map((word, index) => (
                <Fragment key={word}>
                  {index > 0 ? ' ' : null}
                  <span style={{ '--tagline-i': index } as CSSProperties}>{word}</span>
                </Fragment>
              ))}
            </p>
          </div>
        </section>

        <div className="start__menu">
          <button
            type="button"
            className="menucard menucard--accent"
            style={{ '--start-i': 0 } as CSSProperties}
            onClick={() => gameActions().beginSetup('career')}
          >
            <span className="menucard__badge">
              <Glyph name="manager" />
            </span>
            <span className="menucard__body">
              <span className="menucard__kicker">Career mode</span>
              <span className="menucard__title">Start a new career</span>
              {/* The world a career is born into is the whole county, so the
                  sentence says so: it used to promise one ladder of thirty-six
                  clubs, which is a sixth of what a new career is actually handed
                  and a sixth of what it can pick from. */}
              <span className="menucard__desc">
                Generate a local football world from a seed — six districts, each with its own ladder of{' '}
                {DEFAULT_PYRAMID.tiers} divisions of {DEFAULT_PYRAMID.clubsPerTier} — and take charge of any of the
                two hundred and sixteen clubs in them. The squad, the bank balance and the history come with it.
              </span>
            </span>
            <span className="menucard__go">
              <Glyph name="chevron" />
            </span>
          </button>

          <button
            type="button"
            className="menucard"
            style={{ '--start-i': 1 } as CSSProperties}
            onClick={() => gameActions().beginSetup('create-club')}
          >
            <span className="menucard__badge">
              <Glyph name="kit" />
            </span>
            <span className="menucard__body">
              <span className="menucard__kicker">Create a club</span>
              <span className="menucard__title">Build your own side</span>
              <span className="menucard__desc">
                Name it, kit it out, choose its ground and its standing — then take the weakest club's place in
                the division.
              </span>
            </span>
            <span className="menucard__go">
              <Glyph name="chevron" />
            </span>
          </button>

          {/* The saved careers arrive with the doors rather than after them: they
              are the reason a returning manager is here. */}
          <section className="start__saves" style={{ '--start-i': 2 } as CSSProperties}>
            {/* The heading and the two ways in, and nothing between them. A
                sentence under the title used to push the actions onto a line of
                their own, which made two buttons that belong together look like
                two unrelated ones — and it said what the rows, their dates and
                the empty state already say. */}
            <header className="start__saves-head">
              <h2 className="start__saves-title">Continue</h2>
              <div className="row row--wrap">
                {/* Restoring is offered beside the list rather than inside it: on
                    a new device there is nothing here to click, and the file is
                    the whole reason the manager came to this section. */}
                <ImportCareerButton size="sm" label="Restore from a file…" />
                <Button variant="ghost" size="sm" onClick={refreshSaves}>
                  Refresh
                </Button>
              </div>
            </header>
            {bootError && <p className="callout callout--bad" role="alert"><span>{bootError}</span></p>}
            {reading ? <p className="small muted" role="status">Reading saved careers…</p> : failure ? <p role="alert" className="tone tone--bad">{failure}</p> : saves.length === 0 ? (
              <p className="empty">Nothing saved yet. Start a career and the game keeps it up to date on its own.</p>
            ) : (
              <ul className="save-list">
                {saves.map((save) => (
                  <li key={save.slot} className="save-list__item">
                    <div className="save-list__main">
                      <strong>{save.clubName}</strong>
                      {save.auto && <span className="save-list__tag">Autosave</span>}
                      <div className="muted small">
                        {save.seasonLabel} · in-game {formatShortDate(save.date)} · {save.auto ? 'autosaved' : 'saved'}{' '}
                        {formatShortDate(save.savedAt.slice(0, 10))} · seed “{save.seed}”
                      </div>
                    </div>
                    <div className="row row--wrap">
                      <Button
                        variant={save.auto ? 'primary' : 'default'}
                        onClick={() => void loadCareer(save.slot)}
                      >
                        {save.auto ? 'Continue' : 'Load'}
                      </Button>
                      {/* Deleting is offered here because this is the screen with
                          no career on it: nothing is writing the autosave, so
                          removing it sticks. */}
                      <DeleteSaveButton
                        slot={save.slot}
                        label={`${save.clubName}, ${save.seasonLabel}`}
                        onDeleted={() => void readSaves()}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="start__utility" style={{ '--start-i': 3 } as CSSProperties} aria-label="The game itself">
            {UTILITIES.map((item) => (
              <button
                key={item.id}
                type="button"
                className="utilitycard"
                title={item.detail}
                onClick={() => gameActions().openDialog(item.id)}
              >
                <span className="utilitycard__label">{item.label}</span>
                <span className="utilitycard__detail">{item.detail}</span>
              </button>
            ))}
          </section>

          {/* The one thing on this screen that asks for something, so it sits
              above the build number and below everything the manager came for. */}
          <div style={{ '--start-i': 4 } as CSSProperties}>
            <InstallCard />
          </div>

          <p className="start__version" style={{ '--start-i': 5 } as CSSProperties}>
            Sunday Eleven 27 <span className="start__version-number">{versionLabel()}</span>
          </p>
        </div>
      </div>
      {/* The file that has been chosen, put to the manager over the menu. */}
      <CareerImportConfirm />
    </div>
  );
}
