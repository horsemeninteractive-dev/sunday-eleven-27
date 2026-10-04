import { useCallback, useEffect, useMemo, useState } from 'react';
import { isPlayer, type Player } from '@/domain/person';
import { formatDayMonth } from '@/simulation/calendar';
import { useGame } from '../hooks';
import { useGameStore } from '@/state/gameStore';
import { MATCH_SPEED_LABEL, MATCH_SPEEDS } from '@/state/preferences';
import { buildMatchRenderState, recordedFrame } from '@/presentation/matchPresentation';
import { resolveRenderer } from '@/presentation/matchRenderers';
import { buildReplay, replayAt } from '@/presentation/matchReplay';
import { spatialSecondsPerRealSecond } from '../matchPace';
import { minuteLabel } from '../matchFeed';
import { MatchIncidentBanner } from '../match/MatchIncidentBanner';
import { MatchStatsStrip } from '../match/MatchStats';
import { matchKitColours } from '../kit';
import { Button } from '../components/primitives';

/**
 * Watching a match back.
 *
 * The afternoon is already over: the record is written, and nothing here can
 * change a line of it. The replay reads that record — the same signals and
 * events the match produced — and plays them on its own clock through the same
 * renderer contract the live match uses, so the pitch that draws the match as it
 * happens draws it again just as well. A goal is a goal whether it is nine
 * minutes old or nine weeks.
 *
 * If the match was watched, its movement was recorded as it happened, and the
 * replay plays that back: the real positions, sampled from the same continuous
 * state the live pitch drew. Otherwise it is a reconstruction — only the
 * discrete record survives — and the picture follows the ball from one recorded
 * moment to the next, holding the teams where the moment puts them. Either way
 * it is the same seam, with a clock of its own, and not a second simulation.
 *
 * The clock is local to this screen. A replay cannot touch the career, so it has
 * no business in the store; the store only remembers which match is being
 * watched and where to go back to.
 */
export function ReplayView() {
  const game = useGame();
  const target = useGameStore((state) => state.replay);
  const rendererPreference = useGameStore((state) => state.preferences.renderer);

  const match = game && target ? (game.matches[target.matchId] ?? null) : null;
  // The strips worn in the match being watched back, which for a visiting side
  // is its away shirt rather than its club colour.
  const kitColours = useMemo(
    () =>
      game && match
        ? matchKitColours(game, match.homeClubId, match.awayClubId)
        : { home: '#888888', away: '#888888' },
    [game, match],
  );
  const replay = useMemo(() => (match ? buildReplay(match) : null), [match]);

  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);

  // The transport: real time is spent on the replay clock in steps, so the
  // replay runs at the pace the manager chose and never at the frame rate.
  useEffect(() => {
    if (!playing || !replay) return;
    const rate = spatialSecondsPerRealSecond(speed);
    let frame = 0;
    let last = performance.now();
    // The clock advances every frame, by the real time that actually passed, so
    // the replay runs at the pace the manager chose and never at the frame rate
    // — a slow machine plays the same afternoon over the same wall-clock seconds
    // a fast one does. It is spent every frame rather than banked up and applied
    // a few times a second, because the recorded movement is interpolated: the
    // more often the clock moves, the smoother the picture, and a replay should
    // look as smooth as the match did live.
    const pump = (now: number) => {
      const delta = Math.min(0.25, (now - last) / 1000);
      last = now;
      const step = delta * rate;
      if (step > 0) setSeconds((current) => Math.min(replay.duration, current + step));
      frame = window.requestAnimationFrame(pump);
    };
    frame = window.requestAnimationFrame(pump);
    return () => window.cancelAnimationFrame(frame);
  }, [playing, speed, replay]);

  // The end of the replay is the end of the playback, not a pause.
  useEffect(() => {
    if (replay && seconds >= replay.duration) setPlaying(false);
  }, [seconds, replay]);

  const playerById = useCallback(
    (id: string): Player | undefined => {
      const person = game?.people[id];
      return isPlayer(person) ? person : undefined;
    },
    [game],
  );

  // Where the record is, at this instant. Everything drawn follows from here.
  const frame = replay ? replayAt(replay, seconds) : null;
  // The real movement, when the match was watched: the recording is keyed by
  // football seconds since kick-off — the same clock the frame carries — so the
  // replay reads the exact instant being drawn. Null for an unwatched match,
  // which falls back to the reconstruction.
  const recorded = useMemo(
    () => (match && frame ? recordedFrame(match, frame.second) : null),
    [match, frame?.second],
  );
  const renderState = useMemo(
    () =>
      match && game && frame
        ? buildMatchRenderState(match, game, {
            minute: frame.minute,
            revealed: frame.revealed,
            focus: { x: frame.x, y: frame.y },
            players: recorded?.players,
            ball: recorded?.ball,
          })
        : null,
    // Rebuilt as the replay moves: the frame's numbers are the whole input.
    [match, game, frame?.minute, frame?.revealed, frame?.x, frame?.y, recorded],
  );

  if (!game || !match || !replay || !frame || !renderState) return null;

  const Renderer = resolveRenderer(rendererPreference).Component!;
  // The score is the one the record had reached, not the final score: a replay
  // must not spoil its own ending.
  const score = match.events[frame.revealed - 1]?.scoreAfter ?? { home: 0, away: 0 };
  const home = game.clubs[match.homeClubId]!;
  const away = game.clubs[match.awayClubId]!;
  const side = match.homeClubId === game.userClubId ? 'home' : 'away';
  const minute = minuteLabel(Math.round(frame.minute), frame.firstHalf);

  return (
    <div className="matchday replay">
      <div className="replayhead">
        <div className="replayhead__team replayhead__team--home">
          <span className="replayhead__badge">Replay</span>
          <strong>{home.identity.shortName}</strong>
        </div>
        <div className="replayhead__score">
          {score.home} — {score.away}
          <span className="replayhead__clock">{minute}&#39;</span>
          <span className="replayhead__meta">
            {formatDayMonth(match.date)} · {match.competitionName}
          </span>
        </div>
        <div className="replayhead__team replayhead__team--away">
          <strong>{away.identity.shortName}</strong>
          <Button variant="ghost" size="sm" onClick={() => useGameStore.getState().closeReplay()}>
            Close
          </Button>
        </div>
      </div>

      <div className="matchday__main">
        <div className="matchday__visual">
          {/* The same renderer the live match uses, handed the same shape of
              state — only the state was built from the record, not the match. */}
          <div className="matchday__renderer">
            <Renderer state={renderState} side={side} playerById={playerById} />
            <MatchIncidentBanner state={renderState} playerById={playerById} />
          </div>
        </div>

        <div className="replaybar">
          <div className="replaybar__line">
            <span className="muted small">{minute}&#39;</span>
            <span className="replaybar__text">{frame.cue?.text ?? 'Waiting for the first whistle…'}</span>
          </div>

          <div className="replaybar__row">
            <div className="replaybar__transport">
              <button
                type="button"
                className="chip chip--on"
                aria-label={playing ? 'Pause replay' : 'Play replay'}
                onClick={() => {
                  if (seconds >= replay.duration) setSeconds(0);
                  setPlaying((value) => !value);
                }}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <button type="button" className="chip" onClick={() => setSeconds(0)} title="Start again">
                ↺
              </button>
              <div className="speed" role="group" aria-label="Replay speed">
                {MATCH_SPEEDS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`chip${speed === value ? ' chip--on' : ''}`}
                    onClick={() => setSpeed(value)}
                    title={MATCH_SPEED_LABEL[value] ?? `${value}×`}
                  >
                    {value}×
                  </button>
                ))}
              </div>
            </div>

            <input
              className="replaybar__scrub"
              type="range"
              min={0}
              max={Math.round(replay.duration)}
              step={1}
              value={Math.round(seconds)}
              aria-label="Replay position"
              onChange={(event) => {
                setPlaying(false);
                setSeconds(Number(event.target.value));
              }}
            />
          </div>
        </div>
      </div>

      <div className="matchday__stats">
        <MatchStatsStrip match={match} homeColour={kitColours.home} awayColour={kitColours.away} />
      </div>
    </div>
  );
}
