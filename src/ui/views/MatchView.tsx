import { useEffect, useMemo, useState } from 'react';
import type { Player } from '@/domain/person';
import { isPlayer } from '@/domain/person';
import { gameActions, useGame } from '../hooks';
import { useGameStore } from '@/state/gameStore';
import { buildMatchFeed, type MatchFeed } from '../matchFeed';
import { MatchHeader } from '../match/MatchHeader';
import { MatchIncidentBanner } from '../match/MatchIncidentBanner';
import { CurrentCommentary } from '../match/CurrentCommentary';
import { buildMatchRenderState } from '@/presentation/matchPresentation';
import { buildEngineRenderState } from '@/presentation/matchEnginePresentation';
import { currentLiveEngine } from '@/state/liveEngine';
import { resolveRenderer } from '@/presentation/matchRenderers';
import { TeamSheet } from '../match/TeamSheet';
import { MatchControls, type MatchDrawer } from '../match/MatchControls';
import { MatchStatsStrip } from '../match/MatchStats';
import { FullTimePanel, HalfTimePanel, PreMatchPanel } from '../match/MatchPhases';
import { matchMinuteMs } from '../matchPace';
import { matchKitColours } from '../kit';
import { openMatchReport } from '../reportActions';

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
  const rendererPreference = useGameStore((state) => state.preferences.renderer);
  const [drawer, setDrawer] = useState<MatchDrawer | null>(null);
  // The dressing room, half-time and full-time cards can be put down so the
  // manager can look at the pitch and work in the panels underneath; they come
  // back up whenever the phase changes.
  const [intervalOpen, setIntervalOpen] = useState(true);

  const running = session?.phase === 'in-progress' && !session.paused;
  const speed = session?.speed ?? 1;

  // One clock, pumped once a frame, and it hands over *real* seconds: the
  // presentation decides how much football this frame is worth — fast through
  // ordinary play, slow through a chance, faster still while a skip runs — and
  // the store asks the engine for exactly that much. The compression is not a
  // constant here any more, so the pitch keeps up with the passage it is showing
  // instead of racing a fixed ratio. The football is identical at every speed;
  // only how quickly it is spent changes.
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last = performance.now();
    const pump = (now: number) => {
      const delta = Math.min(0.25, (now - last) / 1000);
      last = now;
      gameActions().advanceSpatial(delta);
      frame = window.requestAnimationFrame(pump);
    };
    frame = window.requestAnimationFrame(pump);
    return () => window.cancelAnimationFrame(frame);
  }, [running, speed, session?.viewingMode]);

  useEffect(() => {
    // A drawer that belonged to one phase should not be left open into another,
    // and each new phase gets its own card.
    if (session?.phase === 'pre-match' || session?.phase === 'half-time' || session?.phase === 'full-time') setDrawer(null);
    setIntervalOpen(true);
  }, [session?.phase]);

  const match = session?.live;
  // The strips the two sides are actually in, which is not the same as the
  // clubs' own colours: a visiting side in a white away shirt is white.
  const kitColours = useMemo(
    () => (game && match ? matchKitColours(game, match.homeClubId, match.awayClubId) : null),
    [game, match],
  );
  // The transcript is only needed by the cards, which ask it for a handful of
  // the afternoon's notable lines.
  const feed: MatchFeed | null = useMemo(
    () => (match ? buildMatchFeed(match) : null),
    [match, session?.revision],
  );
  // The match, read once into the neutral shape every renderer consumes. Once
  // the whistle has gone the football is the engine's, so the renderer is handed
  // the engine's own state — the players, the ball and the residual it
  // interpolates with — and never decides anything of its own. Before kick-off
  // there is no engine yet, so the teams are laid out from their formations.
  const renderState = useMemo(
    () => {
      if (!match || !game) return null;
      const engine = currentLiveEngine();
      // The engine is asked to play exactly as far as the presentation has
      // watched, so its live state *is* the moment on screen — no second account
      // of the match, and the clock, the score and the pitch all agree.
      const base = engine ? buildEngineRenderState(engine, match, game) : buildMatchRenderState(match, game);
      // The pitch wears the strips the sides are actually in, the same ones the
      // team sheets and the commentary bar use — not each club's own colours,
      // which can collide when two clubs play in the same shade.
      if (!kitColours) return base;
      return {
        ...base,
        teams: {
          home: { ...base.teams.home, colours: { ...base.teams.home.colours, primary: kitColours.home } },
          away: { ...base.teams.away, colours: { ...base.teams.away.colours, primary: kitColours.away } },
        },
      };
    },
    [match, game, kitColours, session?.revision],
  );

  if (!game || !session || !match || !feed || !renderState) return null;

  // Which renderer draws the match is the manager's preference and nothing else:
  // the simulation above holds the clock, the positions and the result, so
  // switching here is a repaint, not a restart.
  const Renderer = resolveRenderer(rendererPreference).Component!;

  const playerById = (id: string): Player | undefined => {
    const person = game.people[id];
    return isPlayer(person) ? person : undefined;
  };

  const phase = session.phase;
  // Commentary only is commentary only: with the words carrying the match there
  // is no pitch to watch, so the two team sheets take the space the renderer
  // would have had rather than framing an empty middle.
  const commentaryOnly = session.viewingMode === 'commentary';

  return (
    <div className="matchday">
      <MatchHeader game={game} match={match} side={session.side} phase={phase} />

      <div className="matchday__main">
        <div className={`matchday__stage${commentaryOnly ? ' matchday__stage--commentary' : ''}`}>
          <TeamSheet
            side="home"
            club={game.clubs[match.homeClubId]!}
            lineup={match.lineups.home}
            match={match}
            playerById={playerById}
            colour={kitColours?.home ?? '#888888'}
          />
          {!commentaryOnly && (
            <div className="matchday__visual">
              {/* The renderer draws the football; the banner sits beside it. Both
                  take the same neutral state, so the incident reads the same in
                  any renderer. */}
              <div className="matchday__renderer">
                <Renderer state={renderState} side={session.side} playerById={playerById} />
                <MatchIncidentBanner state={renderState} playerById={playerById} />
              </div>
            </div>
          )}
          <TeamSheet
            side="away"
            club={game.clubs[match.awayClubId]!}
            lineup={match.lineups.away}
            match={match}
            playerById={playerById}
            colour={kitColours?.away ?? '#888888'}
          />
        </div>

        {phase !== 'pre-match' && (
          <CurrentCommentary
            commentary={match.commentary ?? []}
            revision={session.revision}
            paused={session.paused}
            /* The bar's hold is a legibility floor, not the match pace; it is
               scaled off the speed so a line stays readable while the
               presentation is fast-forwarding. */
            minuteMs={matchMinuteMs(speed)}
            live
            homeColour={kitColours?.home ?? '#888888'}
            awayColour={kitColours?.away ?? '#888888'}
          />
        )}
      </div>

      <div className="matchday__stats">
        {kitColours && <MatchStatsStrip match={match} homeColour={kitColours.home} awayColour={kitColours.away} />}
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
            openMatchReport(match.id);
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
