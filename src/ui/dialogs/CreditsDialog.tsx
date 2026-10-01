import { BrandLockup } from '../components/BrandMark';
import { CREDITS, CREDITS_INTRO, CREDITS_NOTE } from '../credits';
import { gameActions } from '../hooks';
import { versionLabel } from '@/version';
import { Dialog } from './Dialog';

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
        <p className="credits__intro">{CREDITS_INTRO}</p>
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
