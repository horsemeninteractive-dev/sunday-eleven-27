import { useEffect, useMemo, useState } from 'react';
import type { Player } from '@/domain/person';
import { isPlayer } from '@/domain/person';
import { gameActions, useGame } from '../hooks';
import { useGameStore } from '@/state/gameStore';
import { buildMatchFeed, type MatchFeed } from '../matchFeed';
import { MatchHeader } from '../match/MatchHeader';
import { MatchPitch } from '../match/MatchPitch';
import { CurrentCommentary } from '../match/CurrentCommentary';
import { TeamSheet } from '../match/TeamSheet';
import { MatchControls, type MatchDrawer } from '../match/MatchControls';
import { MatchStatsStrip } from '../match/MatchStats';
import { FullTimePanel, HalfTimePanel, PreMatchPanel } from '../match/MatchPhases';
import { matchMinuteMs, spatialSecondsPerRealSecond } from '../matchPace';

/**
 * Matchday, as a workspace rather than a page.
 *
 * The whole afternoon occupies the window and nothing about it scrolls: the
 * header holds the score and the clock, the pitch takes the middle on its own,
 * the current commentary is a bar underneath it, and the stats and the
 * manager's own controls are pinned along the bottom. There is no side column —
 * the pitch is the point, and it is given every pixel the commentary bar and
 * the header can spare.
 *
 * There is no transcript on screen while the game is running either: the match
 * is watched, and the full history is a tab away when he wants it. The dressing
 * room, half time and full time are cards over the top of the pitch rather than
 * panels beside it, so they never cost the match any room.
 *
 * The match itself is an appointment in the calendar: `pre-match` is the
 * dressing room, the whistle starts the clock, half time stops it again, and
 * full time gives the week back.
 */
export function MatchView() {
  const game = useGame();
  const session = useGameStore((state) => state.session);
  const [drawer, setDrawer] = useState<MatchDrawer | null>(null);
  // The dressing room, half-time and full-time cards can be put down so the
  // manager can look at the pitch and work in the panels underneath; they come
  // back up whenever the phase changes.
  const [intervalOpen, setIntervalOpen] = useState(true);

  const running = session?.phase === 'in-progress' && !session.paused;
  const speed = session?.speed ?? 1;

  // One clock, pumped once a frame: it spends real time on the simulation's
  // fixed steps, and turns it into match minutes at the manager's chosen speed.
  // The football decides everything; this only says how fast it is watched.
  useEffect(() => {
    if (!running) return;
    const rate = spatialSecondsPerRealSecond(speed);
    const minuteMs = matchMinuteMs(speed);
    let frame = 0;
    let last = performance.now();
    let watched = 0;
    const pump = (now: number) => {
      const delta = Math.min(0.25, (now - last) / 1000);
      last = now;
      gameActions().advanceSpatial(delta * rate);
      watched += delta * 1000;
      if (watched >= minuteMs) {
        watched = 0;
        gameActions().tickMatch();
      }
      frame = window.requestAnimationFrame(pump);
    };
    frame = window.requestAnimationFrame(pump);
    return () => window.cancelAnimationFrame(frame);
  }, [running, speed]);

  useEffect(() => {
    // A drawer that belonged to one phase should not be left open into another,
    // and each new phase gets its own card.
    if (session?.phase === 'pre-match' || session?.phase === 'half-time' || session?.phase === 'full-time') setDrawer(null);
    setIntervalOpen(true);
  }, [session?.phase]);

  const match = session?.live;
  // The transcript is only needed by the cards, which ask it for a handful of
  // the afternoon's notable lines.
  const feed: MatchFeed | null = useMemo(
    () => (match ? buildMatchFeed(match) : null),
    [match, session?.revision],
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

      <div className="matchday__main">
        <div className="matchday__stage">
          <TeamSheet
            side="home"
            club={game.clubs[match.homeClubId]!}
            lineup={match.lineups.home}
            match={match}
            playerById={playerById}
          />
          <div className="matchday__visual">
            <MatchPitch match={match} side={session.side} playerById={playerById} />
          </div>
          <TeamSheet
            side="away"
            club={game.clubs[match.awayClubId]!}
            lineup={match.lineups.away}
            match={match}
            playerById={playerById}
          />
        </div>

        {phase !== 'pre-match' && (
          <CurrentCommentary
            commentary={match.commentary ?? []}
            revision={session.revision}
            paused={session.paused}
            speed={session.speed}
            minuteMs={matchMinuteMs(session.speed)}
            live
            homeColours={game.clubs[match.homeClubId]!.identity.colours}
            awayColours={game.clubs[match.awayClubId]!.identity.colours}
          />
        )}
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

      {phase === 'pre-match' && intervalOpen && (
        <PreMatchPanel
          game={game}
          match={match}
          session={session}
          playerById={playerById}
          onLookAround={() => setIntervalOpen(false)}
        />
      )}
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
