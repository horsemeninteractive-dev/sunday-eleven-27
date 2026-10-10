import { useEffect, useRef, useState } from 'react';
import { MESSAGE_PRIORITY_LABEL, type Conversation, type ResponseOption } from '@/domain/communication';
import type { GameState } from '@/domain/game';
import { useGameStore } from '@/state/gameStore';
import { useGame, gameActions } from '../hooks';
import {
  inboxAttention,
  inboxEmptyCopy,
  inboxRows,
  inboxUnread,
  kindLabel,
  liveThreadOptions,
  personName,
  threadActions,
  threadFace,
  threadMessages,
  type InboxRow,
  type ManagerAction,
} from '../inboxState';
import { Button, EmptyState, PageHeader } from '../components/primitives';
import { Glyph } from '../components/icons';
import { Portrait } from '../components/Portrait';

/**
 * Messages.
 *
 * A phone, not a CRM. The design brief for this screen is one sentence long:
 * these are the people involved in my football club and they are contacting me.
 * Everything that serves that sentence is here — who wrote, what they said, when,
 * and something the manager can actually say back — and everything that does not
 * (thread ids, intent names, message types, consequence state) is somewhere
 * else.
 *
 * The people are people, too. Everybody in this game is drawn — `Portrait.tsx`
 * takes his own name apart and draws him — so a thread with a man is headed with
 * him, the row that opens it carries him, and his own words carry his face. A
 * group has no single face and is drawn with its name alone; the manager's own
 * messages carry none, because he is the one reading.
 *
 * Two shapes from one component, because the state is one thing. On a phone the
 * list is a screen and opening a thread replaces it; from a desktop width they
 * sit side by side, so the manager can read a message and see what else is
 * waiting without going back. There is no third layout and no router between
 * them, which is what keeps the phone one tap deep.
 */
export function InboxView() {
  const game = useGame();
  const openId = useGameStore((state) => state.openConversationId);
  if (!game) return null;

  const unread = inboxUnread(game);
  const conversation = openId ? game.communication?.conversations[openId] : undefined;

  return (
    <div className={`inbox${conversation ? ' inbox--reading' : ''}`}>
      <InboxList unread={unread} />
      {conversation && <ConversationPane key={conversation.id} conversation={conversation} />}
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * The list
 * ------------------------------------------------------------------------ */

function InboxList({ unread }: { unread: number }) {
  const game = useGame();
  const openId = useGameStore((state) => state.openConversationId);
  if (!game) return null;

  const rows = inboxRows(game);
  const attention = inboxAttention(game);
  const empty = inboxEmptyCopy();

  return (
    <section className="inbox__list" aria-label="Conversations">
      <PageHeader
        eyebrow="The club"
        title="Messages"
        photo="/photos/inbox-noticeboard.webp"
        meta={
          unread > 0 ? (
            <span className="inbox__unread-note">
              {unread} unread{attention > 0 ? ` · ${attention} to look at` : ''}
            </span>
          ) : (
            <span className="small muted">All read</span>
          )
        }
      />

      {rows.length === 0 ? (
        <EmptyState>{empty.title}</EmptyState>
      ) : (
        <ul className="inbox__rows" tabIndex={0} aria-label="Message threads">
          {rows.map((row) => (
            <Row key={row.conversationId} row={row} open={row.conversationId === openId} />
          ))}
        </ul>
      )}

      {rows.length > 0 && <p className="inbox__footnote">{empty.detail}</p>}
    </section>
  );
}

/**
 * One thread, as a row.
 *
 * Exported because the rule it carries — a thread with one man in it is drawn
 * with him, and a room full of people is drawn without anybody — is worth testing
 * as the markup a browser is handed rather than as a fact about this file. It
 * takes everything it draws from the row it is given, and reaches for the store
 * only when it is pressed, so it renders without a career.
 */
export function Row({ row, open }: { row: InboxRow; open: boolean }) {
  const unread = row.unread > 0;
  return (
    <li>
      <button
        type="button"
        className={`inbox__row${unread ? ' inbox__row--unread' : ''}${open ? ' inbox__row--open' : ''}`}
        aria-current={open ? 'true' : undefined}
        data-conversation={row.conversationId}
        onClick={() => gameActions().openConversation(row.conversationId)}
      >
        {/* Him, at the left of the row, because a message list is a list of
            people and a man is drawn in this game rather than named. Nobody is
            drawn for a room full of people — see `threadFace` in `inboxState.ts`,
            which is the same rule the thread's own head is drawn to. */}
        {row.face && <Portrait person={row.face} />}
        <span className="inbox__row-main">
          {/* The name is the row. Nothing outranks it, so it is the first thing
              in the accessible order too. */}
          <span className="inbox__row-top">
            <span className="inbox__row-name">{row.name}</span>
            <span className="inbox__row-when" title={row.whenTitle}>
              {row.when}
            </span>
          </span>
          <span className="inbox__row-bottom">
            {row.attention && (
              <span className="inbox__priority" title="Wants your attention">
                {MESSAGE_PRIORITY_LABEL[row.priority]}
              </span>
            )}
            <span className="inbox__row-preview">
              {/* A manager reads his own messages differently from other people's,
                  so the thread says who said the last thing. */}
              {row.standing && <span className="inbox__row-standing">{row.standing} · </span>}
              {row.lastFromManager && <span className="inbox__row-you">You: </span>}
              {row.preview}
            </span>
            {unread && (
              <span className="inbox__dot" aria-label={`${row.unread} unread`}>
                {row.unread}
              </span>
            )}
          </span>
        </span>
        {/* The type is worth saying for a group or a committee, and worth
            omitting for the ordinary one-to-one, which is most of them. */}
        {row.kind !== 'player' && row.kindLabel && <span className="inbox__kind">{row.kindLabel}</span>}
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------------ *
 * The thread
 * ------------------------------------------------------------------------ */

function ConversationPane({ conversation }: { conversation: Conversation }) {
  const game = useGame();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [conversation.id]);
  const close = () => {
    gameActions().closeConversation();
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-conversation="${CSS.escape(conversation.id)}"]`)?.focus());
  };
  if (!game) return null;

  const messages = threadMessages(game, conversation.id);
  const others = conversation.participantIds.filter((id) => id !== 'user_manager');
  const name = others.length === 1 ? personName(game, others[0]!) : conversation.title;
  const kind = kindLabel(conversation);
  // Him, where the thread is with one man: a room full of people has no single
  // face to put up there. See `threadFace` in `inboxState.ts`.
  const face = threadFace(game, conversation);

  return (
    <section className="inbox__thread" aria-label={`Conversation with ${name}`}>
      <header className="inbox__thread-head">
        {/* On a phone this bar is the only way back to the list, so it carries
            the back arrow as well as the name. On a wide screen the arrow is
            hidden by CSS rather than removed, so the button keeps its meaning. */}
        <button type="button" className="inbox__back" onClick={close} aria-label="Back to messages">
          <span aria-hidden="true">‹</span> Messages
        </button>
        {face && (
          <span className="inbox__thread-face">
            <Portrait person={face} size="md" />
          </span>
        )}
        <h2 ref={headingRef} tabIndex={-1} className="inbox__thread-name">{name}</h2>
        {kind && <span className="inbox__thread-kind">{kind}</span>}
        {others.length > 1 && (
          <p className="inbox__thread-people">{others.map((id) => personName(game, id)).join(', ')}</p>
        )}
      </header>

      <MessageLog game={game} messages={messages} emptyCopy="Nothing has been said in here yet." />

      <ReplyBar conversation={conversation} />
    </section>
  );
}

/**
 * The messages themselves, as a list to scroll.
 *
 * Exported because it is a drawing of two things it is handed — who said what,
 * and who wrote each line — and takes nothing from the store at all. That makes
 * the one rule in here, "whose sentence gets a face beside it", testable as the
 * markup a browser would get, rather than as a fact about this file's source.
 */
export function MessageLog({
  game,
  messages,
  emptyCopy,
}: {
  game: GameState;
  messages: ReturnType<typeof threadMessages>;
  emptyCopy: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  // A phone scrolls to the bottom of a conversation, not the top of it: the
  // thing that just arrived is the thing being read.
  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, messages[messages.length - 1]?.id]);

  if (messages.length === 0) {
    return (
      <div className="inbox__log inbox__log--empty">
        <p className="empty">{emptyCopy}</p>
      </div>
    );
  }

  return (
    <div className="inbox__log" ref={scroller} tabIndex={0} role="region" aria-label="Message content">
      {messages.map((message) => {
        // The man who wrote it, drawn. Everybody else's sentence carries a face;
        // the manager's own carries none, because he is the one reading — and a
        // face cannot be drawn for anybody the save no longer holds, which is why
        // the name is still what gets printed.
        const sender = game.people[message.senderId];
        return (
          <div key={message.id}>
            {message.startsDay && <p className="inbox__day">{message.dayLabel}</p>}
            <article className={`bubble${message.mine ? ' bubble--mine' : ''}`}>
              {!message.mine && sender && (
                <span className="bubble__face">
                  <Portrait person={sender} size="sm" />
                </span>
              )}
              <div className="bubble__words">
                {/* A sender name on every one of the manager's own messages would be
                    noise; on anybody else's it is the point. The group case needs
                    it either way, because "who said that" is genuinely ambiguous. */}
                {!message.mine && <p className="bubble__from">{message.sender}</p>}
                <p className="bubble__body">{message.body}</p>
                <p className="bubble__when" title={message.whenTitle}>
                  {message.when}
                </p>
              </div>
            </article>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------ *
 * Saying something back
 * ------------------------------------------------------------------------ */

/**
 * What the manager can say.
 *
 * Not a keyboard and not a free-text box: the simulation models what a message
 * *does*, not what anybody would type, so a box would collect words nothing
 * reads. The actions are the eleven things the architecture can do, written the
 * way a manager would say them, and the intent travels underneath where no
 * screen shows it.
 *
 * They are a row of buttons rather than a sheet because on a phone they have to
 * be one tap, and because a manager who has come here to ask about a man's
 * fitness wants the question, not a menu.
 */
function ReplyBar({ conversation }: { conversation: Conversation }) {
  const [expanded, setExpanded] = useState(false);
  const game = useGame();
  // A player thread's options are worked out live from the player's own record,
  // so "How is the knock?" is offered to a man with a hamstring and a man who is
  // not expecting to hear about one. Every other thread is not about a player
  // and reads its options from the message.
  const live: ResponseOption[] = game ? liveThreadOptions(game, conversation) : [];
  const actions = threadActions(conversation, live);
  if (actions.length === 0) return null;

  // The suggestions first, then the rest behind one tap. Eleven buttons is a
  // menu, and a menu is what this screen was built not to be: a manager asking
  // whether a man is free wants that one button, not the whole vocabulary of
  // everything the simulation can model. Nothing is removed — "More" is one tap
  // away and everything is still reachable, which is what a manager who wants to
  // answer a question about fitness with an invitation to training needs.
  const shown = expanded ? actions : actions.slice(0, PRIMARY_ACTIONS);

  return (
    <div className="inbox__reply">
      {shown.map((action) => (
        <ReplyButton key={action.intent} action={action} conversationId={conversation.id} />
      ))}
      {actions.length > PRIMARY_ACTIONS && (
        <button
          type="button"
          className="btn btn--ghost inbox__more"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Fewer' : 'More'}
        </button>
      )}
    </div>
  );
}

/**
 * How many actions are offered before the rest are hidden.
 *
 * Three is one row on a phone and two on a desktop, which is the most a manager
 * will look at before deciding he has not found what he wants.
 */
const PRIMARY_ACTIONS = 3;

function ReplyButton({ action, conversationId }: { action: ManagerAction; conversationId: string }) {
  return (
    <Button
      variant="ghost"
      title={action.detail}
      onClick={() => gameActions().sendConversationMessage(conversationId, action.intent)}
    >
      <Glyph name="messages" className="inbox__reply-glyph" />
      {action.label}
    </Button>
  );
}
