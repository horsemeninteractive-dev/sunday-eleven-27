import { useEffect, useRef, useState } from 'react';
import { openMatchReport } from '../reportActions';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { POSITIONS } from '@/domain/positions';
import { isPlayer, type Player } from '@/domain/person';
import {
  FORMATION_IDS,
} from '@/domain/positions';
import {
  MENTALITY_LABEL,
  MENTALITY_ORDER,
  PRESSING_LABEL,
  PRESSING_ORDER,
  TEMPO_LABEL,
  TEMPO_ORDER,
  type Mentality,
  type PressingIntensity,
  type Tempo,
} from '@/domain/tactics';
import { MATCH_SPEEDS, MATCH_SPEED_LABEL } from '@/state/preferences';
import { VIEWING_MODE_DETAIL, VIEWING_MODE_LABEL, VIEWING_MODES } from '@/presentation/matchPlayback';
import type { MatchSession } from '@/state/gameStore';
import { gameActions } from '../hooks';
import { Button, ToneText } from '../components/primitives';
import { Glyph } from '../components/icons';
import { MatchStatsPanel } from './MatchStats';
import { CommentaryTranscript } from './CommentaryTranscript';
import { Dialog } from '../dialogs/Dialog';

/**
 * Everything the manager can do during the match, in one fixed strip.
 *
 * Speed and pause are always to hand; the panels behind the tabs are work he
 * might want to do — change the shape, make a change, look at his players —
 * and none of them take him off the match. The pitch and the score stay where
 * they are while he is in here.
 */

export type MatchDrawer = 'tactics' | 'subs' | 'players' | 'commentary' | 'stats';

export function MatchControls({
  game,
  match,
  session,
  drawer,
  onDrawer,
  showIntervalButton,
  onOpenInterval,
}: {
  game: GameState;
  match: Match;
  session: MatchSession;
  drawer: MatchDrawer | null;
  onDrawer: (drawer: MatchDrawer | null) => void;
  /** The half-time card has been put down; offer to bring it back. */
  showIntervalButton?: boolean;
  onOpenInterval?: () => void;
}) {
  const [optionsOpen, setOptionsOpen] = useState(false);

  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!drawer) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawerRef.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) onDrawer(null); };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true }); };
  }, [drawer, onDrawer]);
  const fullTime = session.phase === 'full-time';
  const preMatch = session.phase === 'pre-match';
  const halfTime = session.phase === 'half-time';
  const running = session.phase === 'in-progress' && !session.paused;
  // How much of the match to watch is a setting, not a transport control, so it
  // lives behind the options button rather than as a row of chips beside the
  // speed. It is offerable whenever there is football left to watch.
  const showOptions = !fullTime && !preMatch;
  const playerById = (id: string): Player | undefined => {
    const person = game.people[id];
    return isPlayer(person) ? person : undefined;
  };

  const tabs: Array<{ id: MatchDrawer; label: string }> = [
    { id: 'tactics', label: 'Tactics' },
    { id: 'subs', label: `Subs (${match.substitutions[session.side]}/3)` },
    { id: 'players', label: 'Players' },
    { id: 'commentary', label: 'Commentary' },
    { id: 'stats', label: 'Stats' },
  ];

  return (
    <div className="matchbar">
      {drawer && (
        <div ref={drawerRef} tabIndex={-1} className="matchbar__drawer" role="region" aria-label={`${drawer} panel`}>
          {drawer === 'tactics' && <TacticsPanel match={match} session={session} />}
          {drawer === 'subs' && (
            <SubsPanel match={match} session={session} playerById={playerById} onDone={() => onDrawer(null)} />
          )}
          {drawer === 'players' && (
            <PlayersPanel match={match} session={session} playerById={playerById} preMatch={preMatch} />
          )}
          {drawer === 'commentary' && (
            <div className="matchbar__transcript">
              <CommentaryTranscript match={match} autoScroll={session.phase === 'in-progress'} />
            </div>
          )}
          {drawer === 'stats' && <MatchStatsPanel match={match} />}
        </div>
      )}

      <div className="matchbar__row">
        <div className="matchbar__transport">
          {!fullTime && !preMatch && (
            /* The glyph alone. It sits beside the speed chips, which say "1x"
               and "4x" and nothing else, so a word here would be the only one in
               the group — and the icon for stop and start is not ambiguous at the
               size it is drawn. */
            <Button
              variant={running ? 'default' : 'primary'}
              onClick={() => gameActions().toggleMatchPause()}
              title={running ? 'Stop the clock' : 'Let it run'}
              ariaLabel={running ? 'Pause the match' : 'Resume the match'}
            >
              <Glyph name={running ? 'pause' : 'play'} />
            </Button>
          )}
          {!fullTime && (
            <div className="speed" role="group" aria-label="Match speed">
              {MATCH_SPEEDS.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  className={`chip${session.speed === speed && !session.paused ? ' chip--on' : ''}`}
                  onClick={() => gameActions().setMatchSpeed(speed)}
                  aria-pressed={session.speed === speed}
                  title={MATCH_SPEED_LABEL[speed] ?? `${speed}×`}
                >
                  {speed}×
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="matchbar__tabs" role="group" aria-label="Match panels">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-expanded={drawer === tab.id}
              className={`tab${drawer === tab.id ? ' tab--active' : ''}`}
              onClick={() => onDrawer(drawer === tab.id ? null : tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="matchbar__go">
          {showOptions && (
            <div className="match-options">
              <Button
                variant="ghost"
                ariaLabel="Match options"
                aria-haspopup="dialog"
                aria-expanded={optionsOpen}
                title="Match options"
                onClick={() => setOptionsOpen((open) => !open)}
              >
                <Glyph name="settings" />
              </Button>
              {optionsOpen && (
                <Dialog title="Match detail" narrow onClose={() => setOptionsOpen(false)}>
                  <div className="stack" role="group" aria-label="How much of the match to watch">
                  {VIEWING_MODES.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={session.viewingMode === mode}
                      className={`match-options__item${session.viewingMode === mode ? ' match-options__item--on' : ''}`}
                      onClick={() => {
                        gameActions().setViewingMode(mode);
                        setOptionsOpen(false);
                      }}
                    >
                      <span className="match-options__label">{VIEWING_MODE_LABEL[mode]}</span>
                      <span className="match-options__detail small muted">{VIEWING_MODE_DETAIL[mode]}</span>
                    </button>
                  ))}
                  </div>
                </Dialog>
              )}
            </div>
          )}
          {preMatch && showIntervalButton && (
            <Button variant="ghost" onClick={onOpenInterval}>
              Matchday briefing
            </Button>
          )}
          {preMatch && (
            <Button variant="primary" size="lg" onClick={() => gameActions().kickOff()}>
              Kick off
            </Button>
          )}
          {halfTime && showIntervalButton && (
            <Button variant="ghost" onClick={onOpenInterval}>
              Half-time summary
            </Button>
          )}
          {fullTime && showIntervalButton && (
            <Button variant="ghost" onClick={onOpenInterval}>
              Match summary
            </Button>
          )}
          {halfTime && (
            <Button variant="primary" size="lg" onClick={() => gameActions().resumeSecondHalf()}>
              Resume second half
            </Button>
          )}
          {session.phase === 'in-progress' && (
            <Button
              variant="ghost"
              ariaLabel="To the whistle"
              onClick={() => gameActions().simulateMatchToEnd()}
              title="Runs the rest of the game through immediately, bench and all"
            >
              <Glyph name="skip" />
              {/* The words are hidden on a phone, where they would push the
                  options button into a column of its own; the aria-label and
                  the title keep the control named. */}
              <span className="matchbar__whistle-label">To the whistle</span>
            </Button>
          )}
          {fullTime && (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  gameActions().finishMatchSession();
                  openMatchReport(match.id);
                }}
              >
                Full report
              </Button>
              <Button
                variant="primary"
                size="lg"
                onClick={() => {
                  gameActions().finishMatchSession();
                  gameActions().setView('dashboard');
                }}
              >
                Back to the club
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TacticsPanel({ match, session }: { match: Match; session: MatchSession }) {
  const tactics = match.lineups[session.side].tactics;
  const frozen = session.phase === 'full-time';
  const set = (next: Partial<typeof tactics>) => gameActions().setMatchTactics({ ...tactics, ...next });

  return (
    <div className="drawer-grid">
      <Field label="Shape">
        <select
          className="input"
          value={tactics.formation}
          disabled={frozen}
          onChange={(event) => set({ formation: event.target.value as typeof tactics.formation })}
        >
          {FORMATION_IDS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Mentality">
        <select
          className="input"
          value={tactics.mentality}
          disabled={frozen}
          onChange={(event) => set({ mentality: event.target.value as Mentality })}
        >
          {MENTALITY_ORDER.map((value) => (
            <option key={value} value={value}>
              {MENTALITY_LABEL[value]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Tempo">
        <select
          className="input"
          value={tactics.tempo}
          disabled={frozen}
          onChange={(event) => set({ tempo: event.target.value as Tempo })}
        >
          {TEMPO_ORDER.map((value) => (
            <option key={value} value={value}>
              {TEMPO_LABEL[value]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Pressing">
        <select
          className="input"
          value={tactics.pressing}
          disabled={frozen}
          onChange={(event) => set({ pressing: event.target.value as PressingIntensity })}
        >
          {PRESSING_ORDER.map((value) => (
            <option key={value} value={value}>
              {PRESSING_LABEL[value]}
            </option>
          ))}
        </select>
      </Field>
      <p className="drawer-note small muted">
        {frozen ? 'The match is over.' : 'Changes are sent straight to Touchline for the next passage of play.'}
      </p>
    </div>
  );
}

function SubsPanel({
  match,
  session,
  playerById,
  onDone,
}: {
  match: Match;
  session: MatchSession;
  playerById: (id: string) => Player | undefined;
  onDone: () => void;
}) {
  const lineup = match.lineups[session.side];
  const spent = match.substitutions[session.side] >= 3;
  const frozen = session.phase === 'full-time';

  if (session.phase === 'pre-match') {
    return <p className="drawer-note small muted">The bench comes into it from kick-off.</p>;
  }

  return (
    <div className="subs">
      {lineup.bench.length === 0 && <p className="empty">Nobody on the bench.</p>}
      <ul className="subs__list">
        {lineup.bench.map((slot) => {
          const player = playerById(slot.playerId);
          const performance = match.performances[slot.playerId];
          const energy = Math.round(performance?.energy ?? player?.fitness ?? 0);
          return (
            <li key={slot.playerId} className="subs__row">
              <span className="subs__name">
                <strong>{player ? `${player.firstName.charAt(0)}. ${player.surname}` : 'Unknown'}</strong>
                <span className="small muted"> {POSITIONS[slot.position].code}</span>
              </span>
              <span className="small muted">energy {energy}</span>
              <select
                className="input input--small"
                disabled={spent || frozen}
                defaultValue=""
                aria-label={`Bring on ${player?.surname ?? 'substitute'} for`}
                onChange={(event) => {
                  const outgoing = event.target.value;
                  if (outgoing && player) gameActions().makeSubstitution(outgoing, player.id);
                  event.target.value = '';
                  onDone();
                }}
              >
                <option value="">bring on for…</option>
                {lineup.starting.map((starter) => {
                  const out = playerById(starter.playerId);
                  return (
                    <option key={starter.playerId} value={starter.playerId}>
                      {POSITIONS[starter.position].code} {out ? out.surname : ''}
                    </option>
                  );
                })}
              </select>
            </li>
          );
        })}
      </ul>
      <p className="drawer-note small muted">
        {spent
          ? 'All three changes used.'
          : `${3 - match.substitutions[session.side]} change${3 - match.substitutions[session.side] === 1 ? '' : 's'} left.`}
      </p>
    </div>
  );
}

function PlayersPanel({
  match,
  session,
  playerById,
  preMatch,
}: {
  match: Match;
  session: MatchSession;
  playerById: (id: string) => Player | undefined;
  preMatch: boolean;
}) {
  const lineup = match.lineups[session.side];

  return (
    <div className="players">
      <h4 className="subhead">On the pitch</h4>
      <ul className="players__list">
        {lineup.starting.map((slot, index) => {
          const player = playerById(slot.playerId);
          const performance = match.performances[slot.playerId];
          const energy = Math.round(performance?.energy ?? player?.fitness ?? 0);
          return (
            <li key={`${slot.playerId}-${index}`} className="players__row">
              <span className="players__pos">{POSITIONS[slot.position].code}</span>
              <span className="players__name">
                {player ? `${player.firstName.charAt(0)}. ${player.surname}` : 'Unknown'}
                {slot.outOfPosition && <span className="tone tone--warn" title="Out of position"> ⚠</span>}
                {performance?.yellowCards ? <span className="cards cards--yellow" title="Booked" /> : null}
                {performance?.redCards ? <span className="cards cards--red" title="Sent off" /> : null}
              </span>
              {performance?.goals ? <span className="players__goals">{performance.goals}⚽</span> : <span />}
              <span className="players__rating">{performance ? performance.rating.toFixed(1) : '–'}</span>
              <span className="players__energy">
                <ToneText tone={energy < 35 ? 'bad' : energy < 60 ? 'warn' : 'muted'}>{energy}</ToneText>
              </span>
              {preMatch && (
                <select
                  className="input input--small"
                  defaultValue=""
                  aria-label={`Replace ${player?.surname ?? 'player'}`}
                  onChange={(event) => {
                    const incoming = event.target.value;
                    if (incoming) gameActions().swapSessionPlayers(slot.playerId, incoming);
                    event.target.value = '';
                  }}
                >
                  <option value="">swap with…</option>
                  {lineup.bench.map((bench) => {
                    const sub = playerById(bench.playerId);
                    return (
                      <option key={bench.playerId} value={bench.playerId}>
                        {POSITIONS[bench.position].code} {sub ? sub.surname : ''}
                      </option>
                    );
                  })}
                </select>
              )}
            </li>
          );
        })}
      </ul>

      {!preMatch && lineup.bench.length > 0 && (
        <>
          <h4 className="subhead">Bench</h4>
          <ul className="players__list">
            {lineup.bench.map((slot) => {
              const player = playerById(slot.playerId);
              const performance = match.performances[slot.playerId];
              const energy = Math.round(performance?.energy ?? player?.fitness ?? 0);
              return (
                <li key={slot.playerId} className="players__row players__row--bench">
                  <span className="players__pos">{POSITIONS[slot.position].code}</span>
                  <span className="players__name">{player ? `${player.firstName.charAt(0)}. ${player.surname}` : 'Unknown'}</span>
                  <span />
                  <span className="players__rating">–</span>
                  <span className="players__energy">
                    <ToneText tone={energy < 35 ? 'bad' : 'muted'}>{energy}</ToneText>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
    </label>
  );
}
