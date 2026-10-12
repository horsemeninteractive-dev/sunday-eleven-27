import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Player } from '@/domain/person';
import { isPlayer } from '@/domain/person';
import { gameActions, useGame } from '../hooks';
import { useGameStore } from '@/state/gameStore';
import { fullscreenSupported, isFullscreen, setFullscreen, watchFullscreen } from '@/state/preferences';
import { PitchViewToggle, TvScoreboard } from '../match/PitchScreen';
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
import { LeaveMatchDialog } from '../match/LeaveMatchDialog';
import { useDismissable } from '../components/useModal';
import { MatchStatsStrip } from '../match/MatchStats';
import { MatchTimeline, matchLengthMinutes, timelineMarks } from '../match/MatchTimeline';
import { FullTimePanel, HalfTimePanel, PreMatchPanel } from '../match/MatchPhases';
import { matchMinuteMs } from '../matchPace';

import { matchKitColours, matchTeamColours } from '../kit';
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
  // The minute the rail last sent the manager to, so the transcript opens on the
  // incident he pressed rather than at the top of the afternoon.
  const [askedMinute, setAskedMinute] = useState<number | null>(null);
  // The dressing room, half-time and full-time cards can be put down so the
  // manager can look at the pitch and work in the panels underneath; they come
  // back up whenever the phase changes.
  const [intervalOpen, setIntervalOpen] = useState(true);
  // The pitch, given the whole screen. It is a view of this afternoon rather
  // than a panel of it — the header, the two sheets, the rail and the totals all
  // stand aside and the grass takes the frame — and it is the manager's own
  // state, so nothing about it reaches the save.
  const [pitchOnly, setPitchOnly] = useState(false);
  // Whether *this* view asked the browser for fullscreen, so putting the pitch
  // back does not take a fullscreen the manager had already asked for elsewhere.
  const askedFullscreen = useRef(false);

  const running = session?.phase === 'in-progress' && !session.paused;
  const speed = session?.speed ?? 1;

  // Commentary only is commentary only: with the words carrying the match there
  // is no pitch to give the screen, which is what the effect below is about.
  const commentaryOnly = session?.viewingMode === 'commentary';

  const leavePitchOnly = useCallback(() => {
    setPitchOnly(false);
    if (!askedFullscreen.current) return;
    askedFullscreen.current = false;
    void setFullscreen(false);
  }, []);

  const openPitchOnly = useCallback(() => {
    setPitchOnly(true);
    // The browser's own fullscreen is asked for as well, when it has one and is
    // not already in it: on a desktop or a handset this is a television, and the
    // browser is the one that owns those pixels. A browser that refuses, or one
    // with no fullscreen at all, still gets the pitch on the whole screen, which
    // is the promise the button makes.
    if (fullscreenSupported() && !isFullscreen()) {
      askedFullscreen.current = true;
      void setFullscreen(true).then((full) => {
        askedFullscreen.current = full;
      });
    }
  }, []);

  const togglePitchOnly = useCallback(() => {
    if (pitchOnly) leavePitchOnly();
    else openPitchOnly();
  }, [pitchOnly, leavePitchOnly, openPitchOnly]);

  // Escape, the browser's own way out and the phone's back gesture all give the
  // afternoon back the same way. Inside the browser's fullscreen the Escape key
  // never reaches the page, so the `fullscreenchange` listener hears that
  // decision instead — and only acts on it when this view is the thing that
  // asked for the fullscreen in the first place.
  useEffect(() => {
    if (!pitchOnly) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !isFullscreen()) leavePitchOnly();
    };
    window.addEventListener('keydown', key);
    const stopWatching = watchFullscreen((full) => {
      if (!full && askedFullscreen.current) leavePitchOnly();
    });
    return () => {
      window.removeEventListener('keydown', key);
      stopWatching();
    };
  }, [pitchOnly, leavePitchOnly]);

  // The back gesture puts the pitch back in its place before it asks the harder
  // question about leaving the match, the way it puts a drawer away first.
  useDismissable(pitchOnly, leavePitchOnly);

  // A match watched in words has no pitch to give the screen, so the view cannot
  // outlive the picture it was opened for.
  useEffect(() => {
    if (commentaryOnly) leavePitchOnly();
  }, [commentaryOnly, leavePitchOnly]);

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

  // The drawer is a panel of this screen rather than a dialog over it, so it is
  // registered as something the back gesture puts away before it asks anything
  // more drastic — see `ui/layers.ts`.
  useDismissable(drawer !== null, () => setDrawer(null));

  // The minute the rail asked for belongs to the visit: with the drawer put
  // down, the next time the manager opens the commentary he wants the match he
  // is watching, not the moment he looked at five minutes ago.
  useEffect(() => {
    if (drawer === null) setAskedMinute(null);
  }, [drawer]);

  // The back gesture asking to leave puts the drawer down first: one question on
  // screen at a time, and the answer to it should not be hidden behind a panel.
  const leavePrompt = useGameStore((state) => state.leaveMatchPrompt);
  useEffect(() => {
    if (leavePrompt) setDrawer(null);
  }, [leavePrompt]);

  const match = session?.live;
  // The strips the two sides are actually in, which is not the same as the
  // clubs' own colours: a visiting side in a white away shirt is white.
  const kitColours = useMemo(
    () => (game && match ? matchKitColours(game, match.homeClubId, match.awayClubId) : null),
    [game, match],
  );
  // Who is in which shirt, as the renderer and the two sheets both want it: the
  // strip each side turned out in, with each keeper in the third strip, read once
  // for the picture and both lists. `matchTeamColours` is the whole of that
  // answer, so the pitch and the sheets cannot come to different ones — a side in
  // a white away shirt still has a keeper who is not.
  const strips = useMemo(
    () => (game && match ? matchTeamColours(game, match.homeClubId, match.awayClubId) : null),
    [game, match],
  );
  // The transcript is only needed by the cards, which ask it for a handful of
  // the afternoon's notable lines.
  const feed: MatchFeed | null = useMemo(
    () => (match ? buildMatchFeed(match) : null),
    [match, session?.revision],
  );
  // What the rail is drawn from: the same feed, key incidents only. Rebuilt on
  // the session's revision because the live match is mutated in place as it is
  // played, so the record itself is not a change the memo can see.
  const marks = useMemo(() => (match ? timelineMarks(match) : []), [match, session?.revision]);
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
      if (!strips) return base;
      return {
        ...base,
        teams: {
          home: { ...base.teams.home, colours: strips.home },
          away: { ...base.teams.away, colours: strips.away },
        },
      };
    },
    [match, game, strips, session?.revision],
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
  // would have had rather than framing an empty middle. And with the pitch on
  // the whole screen there is no room for anything framing it: the sheets, the
  // rail and the totals all stand aside, while the control strip stays where it
  // is — the match is still being played, and a view of it that could not be
  // paused would be a worse one than the screen it replaced.

  return (
    <div className={`matchday${pitchOnly ? ' matchday--pitchonly' : ''}`}>
      {!pitchOnly && <MatchHeader game={game} match={match} side={session.side} phase={phase} />}

      <div className="matchday__main">
        <div className={`matchday__stage${commentaryOnly ? ' matchday__stage--commentary' : ''}`}>
          {!pitchOnly && (
            <TeamSheet
              side="home"
              club={game.clubs[match.homeClubId]!}
              lineup={match.lineups.home}
              match={match}
              playerById={playerById}
              /* The colours the pitch beside it is drawn from, rather than the
                 club's own: the sheet is headed in the strip the side actually
                 turned out in, and the man in goal is in the third strip. */
              colours={renderState.teams.home.colours}
            />
          )}
          {!commentaryOnly && (
            <div className="matchday__visual">
              {/* The renderer draws the football; the banner sits beside it. Both
                  take the same neutral state, so the incident reads the same in
                  any renderer. The scoreboard and the toggle are drawn here too,
                  in the two corners of the picture rather than beside it, so the
                  button is in the same place whether or not the pitch has the
                  screen. */}
              <div className="matchday__renderer">
                <Renderer state={renderState} side={session.side} playerById={playerById} />
                <MatchIncidentBanner state={renderState} playerById={playerById} />
                {pitchOnly && <TvScoreboard game={game} match={match} phase={phase} />}
                <PitchViewToggle full={pitchOnly} onToggle={togglePitchOnly} />
              </div>
            </div>
          )}
          {!pitchOnly && (
            <TeamSheet
              side="away"
              club={game.clubs[match.awayClubId]!}
              lineup={match.lineups.away}
              match={match}
              playerById={playerById}
              colours={renderState.teams.away.colours}
            />
          )}
        </div>

        {!pitchOnly && phase !== 'pre-match' && (
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

      {/* The afternoon on one rail, between the pitch and the totals. A live
          match cannot be rewound, so pressing a mark does what can be done: it
          stops the clock and opens the words at that minute. */}
      {!pitchOnly && phase !== 'pre-match' && marks.length > 0 && (
        <div className="matchday__rail">
          <MatchTimeline
            marks={marks}
            minute={match.minute}
            length={matchLengthMinutes(match)}
            homeColour={kitColours?.home}
            awayColour={kitColours?.away}
            onJump={(mark) => {
              setAskedMinute(mark.rawMinute);
              if (running) gameActions().toggleMatchPause();
              setDrawer('commentary');
            }}
          />
        </div>
      )}

      {!pitchOnly && (
        <div className="matchday__stats">
          {kitColours && <MatchStatsStrip match={match} homeColour={kitColours.home} awayColour={kitColours.away} />}
        </div>
      )}

      <MatchControls
        game={game}
        match={match}
        session={session}
        drawer={drawer}
        onDrawer={setDrawer}
        showIntervalButton={phase !== 'in-progress' && !intervalOpen}
        onOpenInterval={() => setIntervalOpen(true)}
        commentaryMinute={askedMinute}
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
      <LeaveMatchDialog />

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
