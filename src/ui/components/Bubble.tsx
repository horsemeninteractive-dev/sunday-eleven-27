import type { ReactNode } from 'react';

/**
 * One sentence in a conversation, whoever is saying it.
 *
 * The inbox and the negotiation table were each drawing their own: the inbox a
 * `bubble--mine` for the manager and nothing in particular for anybody else, the
 * negotiation a second vocabulary of `bubble--you` and `bubble--them` meaning the
 * same two directions. Two names for one idea is how a thread and a transcript
 * drift into looking like two parts of two different games, so both screens draw
 * this now. The manager's own words take the club's edge and their own side of the
 * page; everybody else's sit the other way, with their face beside them.
 */
export function Bubble({
  mine = false,
  face,
  from,
  when,
  whenTitle,
  children,
}: {
  /** The manager's own words. They are never given a face: he is the one reading. */
  mine?: boolean;
  /** The drawing of whoever is speaking, at the head of the words. */
  face?: ReactNode;
  /** Who is speaking, printed above the words. */
  from?: ReactNode;
  /** A time or a date, printed under them. */
  when?: ReactNode;
  whenTitle?: string;
  /**
   * What was said. Phrasing content, drawn in the bubble's own paragraph — see
   * the body below for why the caller no longer supplies that paragraph.
   */
  children: ReactNode;
}) {
  return (
    <article className={`bubble bubble--${mine ? 'mine' : 'them'}`}>
      {face && <span className="bubble__face">{face}</span>}
      <div className="bubble__words">
        {from && <p className="bubble__from">{from}</p>}
        {/* The sentence, in the bubble's own paragraph.

            It used to be the caller's job, and only one of the two callers did
            it: the inbox wrapped each message in `.bubble__body`, the negotiation
            handed over a bare string — so the wrapping rule that keeps a long
            word inside its bubble was on one screen's messages and not on the
            other's, and the next screen to draw a sentence would have had to know
            to add a class the component's own stylesheet defines. Wrapping it in
            the caller is also how a `p` ends up inside a `p`. */}
        <p className="bubble__body">{children}</p>
        {when && <p className="bubble__when" title={whenTitle}>{when}</p>}
      </div>
    </article>
  );
}
