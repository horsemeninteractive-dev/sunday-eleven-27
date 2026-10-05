import { useEffect, useRef, useState } from 'react';
import type { Conversation, ResponseOption } from '@/domain/communication';
import { useGameStore } from '@/state/gameStore';
import { playerResponseOptions } from '@/simulation/communication/playerConversation';
import { useGame, gameActions } from '../hooks';
import {
  inboxEmptyCopy,
  inboxRows,
  inboxUnread,
  kindLabel,
  personName,
  threadActions,
  threadMessages,
  type InboxRow,
  type ManagerAction,
} from '../inboxState';
import { Button, EmptyState, PageHeader } from '../components/primitives';
import { Glyph } from '../components/icons';

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
      {conversation && <ConversationPane conversation={conversation} />}
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
  const empty = inboxEmptyCopy();

  return (
    <section className="inbox__list" aria-label="Conversations">
      <PageHeader
        eyebrow="The club"
        title="Messages"
        meta={
          unread > 0 ? (
            <span className="inbox__unread-note">
              {unread} unread
            </span>
          ) : (
            <span className="small muted">All read</span>
          )
        }
      />

      {rows.length === 0 ? (
        <EmptyState>{empty.title}</EmptyState>
      ) : (
        <ul className="inbox__rows">
          {rows.map((row) => (
            <Row key={row.conversationId} row={row} open={row.conversationId === openId} />
          ))}
        </ul>
      )}

      {rows.length > 0 && <p className="inbox__footnote">{empty.detail}</p>}
    </section>
  );
}

function Row({ row, open }: { row: InboxRow; open: boolean }) {
  const unread = row.unread > 0;
  return (
    <li>
      <button
        type="button"
        className={`inbox__row${unread ? ' inbox__row--unread' : ''}${open ? ' inbox__row--open' : ''}`}
        aria-current={open ? 'true' : undefined}
        onClick={() => gameActions().openConversation(row.conversationId)}
      >
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
  const close = () => gameActions().closeConversation();
  if (!game) return null;

  const messages = threadMessages(game, conversation.id);
  const others = conversation.participantIds.filter((id) => id !== 'user_manager');
  const name = others.length === 1 ? personName(game, others[0]!) : conversation.title;
  const kind = kindLabel(conversation);

  return (
    <section className="inbox__thread" aria-label={`Conversation with ${name}`}>
      <header className="inbox__thread-head">
        {/* On a phone this bar is the only way back to the list, so it carries
            the back arrow as well as the name. On a wide screen the arrow is
            hidden by CSS rather than removed, so the button keeps its meaning. */}
        <button type="button" className="inbox__back" onClick={close} aria-label="Back to messages">
          <span aria-hidden="true">‹</span> Messages
        </button>
        <h2 className="inbox__thread-name">{name}</h2>
        {kind && <span className="inbox__thread-kind">{kind}</span>}
        {others.length > 1 && (
          <p className="inbox__thread-people">{others.map((id) => personName(game, id)).join(', ')}</p>
        )}
      </header>

      <MessageLog messages={messages} emptyCopy="Nothing has been said in here yet." />

      <ReplyBar conversation={conversation} />
    </section>
  );
}

function MessageLog({
  messages,
  emptyCopy,
}: {
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
    <div className="inbox__log" ref={scroller}>
      {messages.map((message) => (
        <div key={message.id}>
          {message.startsDay && <p className="inbox__day">{message.dayLabel}</p>}
          <article className={`bubble${message.mine ? ' bubble--mine' : ''}`}>
            {/* A sender name on every one of the manager's own messages would be
                noise; on anybody else's it is the point. The group case needs
                it either way, because "who said that" is genuinely ambiguous. */}
            {!message.mine && <p className="bubble__from">{message.sender}</p>}
            <p className="bubble__body">{message.body}</p>
            <p className="bubble__when" title={message.whenTitle}>
              {message.when}
            </p>
          </article>
        </div>
      ))}
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
  const live: ResponseOption[] =
    conversation.type === 'player' && game
      ? playerResponseOptions(game, conversation.participantIds.find((id) => id !== 'user_manager') ?? '')
      : [];
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
