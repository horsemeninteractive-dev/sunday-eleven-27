import { BrandLockup } from '../components/BrandMark';
import { TouchlineLockup } from '../components/TouchlineMark';
import { CREDITS, CREDITS_INTRO, CREDITS_NOTE, TOUCHLINE_NOTE, TOUCHLINE_TAGLINE } from '../credits';
import { gameActions } from '../hooks';
import { versionLabel } from '@/version';
import { Dialog } from './Dialog';

/**
 * Who to thank, and what the game is.
 *
 * Three things in order, and the order is the argument: the game's own mark and
 * name, then Touchline — the simulation underneath it, marked off by a rule
 * above and below so it reads as its own thing rather than as another row of
 * credits — and then the list of what the game was built with and from.
 *
 * Touchline is meant to be important here without overshadowing the game it
 * belongs to: it gets a block of its own and a logo, and Sunday Eleven gets the
 * wordmark at the top of the screen it is on.
 */
export function CreditsDialog() {
  return (
    <Dialog
      title="Credits"
      subtitle={versionLabel()}
      narrow
      onClose={() => gameActions().closeDialog()}
    >
      <div className="credits">
        <div className="credits__mark">
          <BrandLockup />
        </div>
        <p className="credits__game">Sunday League Football Management</p>
        <p className="credits__intro">{CREDITS_INTRO}</p>

        {/* The simulation, between the game it plays and the people who wrote
            it. `aria-label` so the block is a named region rather than an
            unlabelled stretch of a long dialog. */}
        <section className="credits__touchline" aria-label="Touchline">
          <TouchlineLockup detail={TOUCHLINE_TAGLINE} />
          <p className="small muted credits__touchline-note">{TOUCHLINE_NOTE}</p>
        </section>

        <dl className="credits__list">
          {CREDITS.map((credit) => (
            <div className="credits__row" key={credit.role}>
              <dt>{credit.role}</dt>
              <dd>
                <span className="credits__names">{credit.names.join(' · ')}</span>
                {credit.note && <p className="small muted">{credit.note}</p>}
              </dd>
            </div>
          ))}
        </dl>
        <p className="small muted credits__note">{CREDITS_NOTE}</p>
      </div>
    </Dialog>
  );
}
