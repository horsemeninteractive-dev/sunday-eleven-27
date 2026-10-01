import { useEffect } from 'react';
import { noticeLifetime } from '../notice';

/**
 * The game's own voice, in the corner of the footer.
 *
 * A notice is a passing remark — the session was run, the calendar moved, the
 * day did not go the way it looked like it would — so it belongs where a phone
 * would put it: a small bubble off the game's own mark, saying its piece and
 * then going of its own accord. It is deliberately not a panel in the page,
 * because a message you have to dismiss is a message that has become work.
 *
 * The mark is the same favicon the browser tab wears, so a line that appears
 * beside it reads as coming from the game rather than from the screen it lands
 * on.
 */
export function AppNotice({ notice }: { notice: string | null }) {
  return (
    <div className={`appnotice${notice ? ' appnotice--live' : ''}`}>
      {notice && (
        <p className="appnotice__bubble" role="status">
          {notice}
        </p>
      )}
      <span className="appnotice__icon" aria-hidden={notice ? undefined : true}>
        <img src="/favicon.svg" alt="Sunday Eleven 27" width={22} height={22} />
      </span>
    </div>
  );
}

/** Take the current notice away once it has had its moment. */
export function useNoticeTimeout(notice: string | null, dismiss: () => void): void {
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(dismiss, noticeLifetime(notice));
    return () => window.clearTimeout(timer);
  }, [notice, dismiss]);
}
