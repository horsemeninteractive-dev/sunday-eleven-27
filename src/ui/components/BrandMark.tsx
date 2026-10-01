import type { CSSProperties } from 'react';

/**
 * The game's own mark.
 *
 * Not a crest — the world is full of generated club badges, and the game needs
 * a mark that is obviously not one of them. So it is a wordmark instead: the
 * two words that name the game stacked on top of each other, with the season
 * standing beside them.
 *
 * It is set to a grid rather than left to the type: the two words are spread to
 * one width so the block reads as a rectangle, and the year is sized to stand
 * exactly as tall as both lines together. SUNDAY and ELEVEN are not naturally
 * the same width in this weight — the letters are drawn one at a time and
 * spaced out to fill the measure — which is why the words are assembled from
 * their letters here rather than written out.
 */

/** The two halves of the name, stacked in this order. */
const WORDS = ['SUNDAY', 'ELEVEN'];

/** Where a word's letters start counting, so SUNDAY leads and ELEVEN follows. */
function lettersBefore(wordIndex: number): number {
  return WORDS.slice(0, wordIndex).reduce((total, word) => total + word.length, 0);
}

export function BrandLockup({ className }: { className?: string }) {
  return (
    <div className={className ? `brand ${className}` : 'brand'} role="img" aria-label="Sunday Eleven 27">
      <span className="brand__words" aria-hidden="true">
        {WORDS.map((word, wordIndex) => (
          <span key={word} className="brand__word">
            {[...word].map((letter, index) => (
              // Each letter knows its own place in the name, so the mark can set
              // itself one letter at a time when the menu arrives.
              <span key={`${letter}${index}`} style={{ '--brand-i': lettersBefore(wordIndex) + index } as CSSProperties}>
                {letter}
              </span>
            ))}
          </span>
        ))}
      </span>
      <span className="brand__year" aria-hidden="true">
        27
      </span>
    </div>
  );
}
