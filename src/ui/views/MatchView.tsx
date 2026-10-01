import { useEffect, useMemo, useState } from 'react';
import type { Player } from '@/domain/person';
import { isPlayer } from '@/domain/person';
import { gameActions, useGame } from '../hooks';
import { useGameStore } from '@/state/gameStore';
import { buildMatchFeed, type MatchFeed } from '../matchFeed';
import { MatchHeader } from '../match/MatchHeader';
import { MatchPitch } from '../match/MatchPitch';
import { LiveFeed } from '../match/LiveFeed';
import { MatchControls, type MatchDrawer } from '../match/MatchControls';
import { MatchStatsPanel, MatchStatsStrip } from '../match/MatchStats';
import { FullTimePanel, HalfTimePanel, PreMatchPanel } from '../match/MatchPhases';

/** Tick length in milliseconds for each speed setting. */
const TICK_MS: Record<number, number> = { 1: 900, 2: 420, 4: 160 };

type Pane = 'pitch' | 'feed' | 'stats';

/**
 * Matchday, as a workspace rather than a page.
 *
 * The whole afternoon occupies the window and nothing about it scrolls: the
 * header holds the score and the clock, the pitch and the live feed share the
 * middle, the stats and the manager's own controls are pinned along the bottom.
 * Panels that need more room than they have — the feed, the substitution list —
 * scroll inside themselves, which keeps the one thing the manager is looking
 * for where he last saw it.
 *
 * The match itself is an appointment in the calendar: `pre-match` is the
 * dressing room, the whistle starts the clock, half time stops it again, and
 * full time gives the week back.
 */
export function MatchView() {
  const game = useGame();
  const session = useGameStore((state) => state.session);
  const [keyOnly, setKeyOnly] = useState(false);
  const [drawer, setDrawer] = useState<MatchDrawer | null>(null);
  const [pane, setPane] = useState<Pane>('pitch');
  // The half-time and full-time cards can be put down so the manager can work
  // in the panels underneath; they come back up whenever the phase changes.
  const [intervalOpen, setIntervalOpen] = useState(true);

  const running = session?.phase === 'in-progress' && !session.paused;

  useEffect(() => {
    if (!session || !running) return;
    const interval = window.setInterval(() => {
      gameActions().tickMatch();
    }, TICK_MS[session.speed] ?? 900);
    return () => window.clearInterval(interval);
  }, [running, session?.speed, session?.matchId, session?.phase]);

  useEffect(() => {
    // A drawer that belonged to one phase should not be left open into another,
    // and each new phase gets its own card.
    if (session?.phase === 'half-time' || session?.phase === 'full-time') setDrawer(null);
    setIntervalOpen(true);
  }, [session?.phase]);

  const match = session?.live;
  const feed: MatchFeed | null = useMemo(
    () => (match ? buildMatchFeed(match, { keyOnly }) : null),
    [match, keyOnly, session?.revision],
  );

  if (!game || !session || !match || !feed) return null;

  const playerById = (id: string): Player | undefined => {
    const person = game.people[id];
    return isPlayer(person) ? person : undefined;
  };

  const phase = session.phase;

  return (
    <div className="matchday">
      <MatchHeader game={game} match={match} side={session.side} phase={phase} />

      <div className="matchday__switch" role="tablist" aria-label="Match views">
        {(['pitch', 'feed', 'stats'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={pane === option}
            className={`tab${pane === option ? ' tab--active' : ''}`}
            onClick={() => setPane(option)}
          >
            {option === 'pitch' ? 'Pitch' : option === 'feed' ? 'Live feed' : 'Stats'}
          </button>
        ))}
      </div>

      <div className="matchday__main" data-pane={pane}>
        <div className="matchday__visual">
          <MatchPitch match={match} side={session.side} playerById={playerById} />
        </div>

        <div className="matchday__side">
          {phase === 'pre-match' ? (
            <PreMatchPanel game={game} match={match} session={session} playerById={playerById} />
          ) : (
            <LiveFeed
              feed={feed}
              revision={session.revision}
              keyOnly={keyOnly}
              onToggleKeyOnly={() => setKeyOnly((value) => !value)}
            />
          )}
        </div>

        <div className="matchday__statspane">
          <MatchStatsPanel match={match} />
        </div>
      </div>

      <div className="matchday__stats">
        <MatchStatsStrip match={match} />
      </div>

      <MatchControls
        game={game}
        match={match}
        session={session}
        drawer={drawer}
        onDrawer={setDrawer}
        showIntervalButton={phase !== 'in-progress' && !intervalOpen}
        onOpenInterval={() => setIntervalOpen(true)}
      />

      {phase === 'half-time' && intervalOpen && (
        <HalfTimePanel
          game={game}
          match={match}
          session={session}
          feed={feed}
          playerById={playerById}
          onMakeChanges={() => setIntervalOpen(false)}
        />
      )}
      {phase === 'full-time' && intervalOpen && (
        <FullTimePanel
          game={game}
          match={match}
          session={session}
          feed={feed}
          playerById={playerById}
          onReport={() => {
            gameActions().finishMatchSession();
            gameActions().setView('fixtures');
          }}
          onContinue={() => {
            gameActions().finishMatchSession();
            gameActions().setView('dashboard');
          }}
        />
      )}
    </div>
  );
}
