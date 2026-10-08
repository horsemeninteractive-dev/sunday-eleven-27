import { FACE_CHOICE_ROWS, facePlan, type FaceChoiceRow, type FaceSubject } from '../face';
import type { FaceChoices } from '@/domain/face';
import { Button } from './primitives';
import { PortraitArt, officialOutfit } from './Portrait';

/**
 * The manager's own face, being chosen.
 *
 * One man in this game picks his face and only one, so this is not a character
 * creator: it is a mirror with a knob on it. The drawing in the corner is the
 * real drawing — the same `PortraitArt` a squad table renders, from the same
 * `facePlan` — so what is on the screen is exactly what the manager will see on
 * his own page next week, at the size his own page gives him. A preview drawn by
 * some second code path is a preview that can lie, and a face is one of the few
 * things in this game a manager will notice being lied to about.
 *
 * It holds no state and reads no store. Everything it shows is a prop, and every
 * change is handed straight back to the caller, because the same control has two
 * jobs: on the setup screen it edits the profile that will become a career, and
 * on the manager screen it edits the career. What differs between the two is
 * where the choice is kept, which is not something a set of buttons needs to
 * know.
 *
 * What it deliberately does not offer is *everything*. How far apart his eyes
 * are and how high they sit are rolled, not chosen, and they stay that way:
 * they are the two measurements nobody picks about his own face and everybody
 * notices about somebody else's, which makes them the generator's business. The
 * rows are the features a man actually describes himself by, and they are all
 * here.
 */
export interface FaceDesignerProps {
  /** Who the face belongs to: the name and age the roll reads. */
  subject: FaceSubject;
  /** The features to show — whether he chose them or merely rolled them. */
  choices: FaceChoices;
  onChange: (choices: FaceChoices) => void;
  /** Offer him somebody else's face. Omitted where there is nothing to offer it with. */
  onShuffle?: () => void;
  /** Put back the face his own name draws. Omitted when there is nothing to put back. */
  onReset?: () => void;
  /** True when `choices` are his own pick rather than the roll, which the caption says. */
  chosen?: boolean;
}

export function FaceDesigner({ subject, choices, onChange, onShuffle, onReset, chosen = false }: FaceDesignerProps) {
  return (
    <div className="facedesigner">
      <div className="facedesigner__preview">
        {/* His own face at the size his own page gives it, in the coat an
            official wears — see `officialOutfit`. */}
        <span className="portrait portrait--xl" aria-hidden="true">
          <PortraitArt plan={facePlan({ ...subject, face: choices })} outfit={officialOutfit()} detail={2} />
        </span>
        <p className="facedesigner__caption small muted">
          {chosen
            ? 'Yours, and kept in the save with your name. The rest of the face — how far apart your eyes are, the set of your jaw — is still drawn from your name, so it stays put.'
            : 'This is the face your name draws for you. Change anything here and it is yours to keep.'}
        </p>
        {(onShuffle || onReset) && (
          <div className="row row--tight facedesigner__tools">
            {onShuffle && (
              <Button variant="ghost" size="sm" onClick={onShuffle} title="Be drawn a different face entirely">
                Surprise me
              </Button>
            )}
            {onReset && (
              <Button variant="ghost" size="sm" onClick={onReset} title="Throw the choices away and go back to the roll">
                As my name draws me
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="facedesigner__rows">
        {FACE_CHOICE_ROWS.map((row) => (
          <FaceChoice
            key={row.key}
            row={row}
            value={choices[row.key]}
            onPick={(value) => onChange({ ...choices, [row.key]: value } as FaceChoices)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One feature, and every way it can be drawn.
 *
 * The same shape as the tactics screen's option group — a subheading, a
 * segmented row of buttons and a line saying what the choice means — because
 * these are the same kind of decision and the two screens should not be two
 * dialects. The row is data (`FACE_CHOICE_ROWS`) and this is the only place
 * that data is turned into a control, so twelve rows are one idiom rather than
 * twelve.
 *
 * The cast on the way out is the one cost of that: the key is a `keyof
 * FaceChoices` and the value belongs to that key, which TypeScript cannot carry
 * through a computed property. It is written once, here, rather than as twelve
 * branches, and the row's own options are what the value is checked against.
 */
function FaceChoice({
  row,
  value,
  onPick,
}: {
  row: FaceChoiceRow;
  value: string | boolean;
  onPick: (value: string | boolean) => void;
}) {
  return (
    <div className="option-group">
      <div className="option-group__head">
        {/* `h3`, where the tactics screen's option group is an `h4`: this panel is
            one heading deep under the panel that holds it, and the tactics groups
            sit under a zone of their own. Same words, same `.subhead`, one level
            apart — a row label is a reading aid, and a reading aid that skips a
            heading level is one a screen reader hears out of order. */}
        <h3 className="subhead">{row.label}</h3>
      </div>
      <div className="segmented" role="group" aria-label={row.label}>
        {row.options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            className={`segmented__item${value === option.value ? ' segmented__item--active' : ''}`}
            aria-pressed={value === option.value}
            onClick={() => onPick(option.value)}
          >
            {option.colour && (
              <span className="facedesigner__dot" style={{ background: option.colour }} aria-hidden="true" />
            )}
            {option.label}
          </button>
        ))}
      </div>
      <p className="instruction-help">{row.hint}</p>
    </div>
  );
}
