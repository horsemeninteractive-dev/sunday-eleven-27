import type { PyramidId } from '@/domain/ids';
import type { LadderChoice } from '../worldNav';
import { handleTabKeys } from './Tabs';

/**
 * The county's ladders, as a tabstrip.
 *
 * The same control in the three places a manager has to choose which football he
 * is looking at — the club-selection list, the club designer, and the league
 * table — because they are one question: the county has more than one ladder, and
 * the answer is the one he is reading. Its label is the region the ladder draws
 * its clubs from, which is the shortest true name it has, and the ladder's own
 * long name, its level and its size are in the tooltip behind it.
 *
 * A world with a single ladder draws nothing: a tabstrip with one tab cannot
 * change anything, and a county written before its districts existed should look
 * exactly as it did. That is why the guard is in here rather than repeated by
 * each caller — the screens should not each have to remember that one ladder is
 * not a choice.
 */
export function PyramidPicker({
  choices,
  selected,
  onSelect,
  label,
  controls,
  className,
}: {
  choices: readonly LadderChoice[];
  selected: PyramidId;
  onSelect: (pyramidId: PyramidId) => void;
  /** The accessible name of the group, in the plural: 'Leagues'. */
  label: string;
  /** The panel this picker chooses the contents of, when it owns one. */
  controls?: string;
  className?: string;
}) {
  if (choices.length < 2) return null;
  return (
    <div
      className={`segmented${className ? ` ${className}` : ''}`}
      role="tablist"
      aria-label={label}
      onKeyDown={handleTabKeys}
    >
      {choices.map((choice) => {
        const active = choice.id === selected;
        return (
          <button
            key={choice.id}
            type="button"
            role="tab"
            id={`ladder-tab-${choice.id}`}
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            {...(controls ? { 'aria-controls': controls } : {})}
            title={choice.hint}
            className={`segmented__item${active ? ' segmented__item--active' : ''}`}
            onClick={() => onSelect(choice.id)}
          >
            {choice.label}
            {/* Which ladder is his own is said on the control rather than left to
                be worked out from the page: a manager browsing a ladder next door
                has to be able to see at a glance which one he plays in. */}
            {choice.mine ? ' · yours' : ''}
          </button>
        );
      })}
    </div>
  );
}
