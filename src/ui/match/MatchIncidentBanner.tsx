import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Player } from '@/domain/person';
import type { MatchRenderState } from '@/presentation/renderContract';
import { incidentTone, incidentsOf, newIncidents, type MatchSignal, type MatchSignalKind } from '@/presentation/matchSignals';
import { minuteLabel } from '../matchFeed';

/**
 * The incident banner.
 *
 * It announces the things worth interrupting the picture for — a goal, a foul,
 * an offside, a card — from the shared signal stream and nothing else. It is
 * mounted *beside* the renderer, not inside it, and it never asks which renderer
 * is running: the same signal produces the same banner over the 2D pitch as it
 * would over a 3D scene, because both are handed the same state. That is the
 * whole point of a neutral event stream — a goal does not become a different
 * goal depending on how the match is drawn.
 *
 * It reads, it does not simulate. The incident is already in the record before
 * the banner hears of it; the banner only decides what to hold up and for how
 * long.
 *
 * Incidents are *queued*, not replaced. A foul and the booking that follows it
 * arrive together in the same minute, and showing only the newest would swallow
 * the foul the moment the card landed. So the banner shows them in the order
 * they happened, one at a time, rather than letting the later one cut off the
 * earlier.
 */

/** How long an incident stays on screen, in real time. */
const INCIDENT_MS = 3600;
/**
 * The most incidents that may be waiting their turn.
 *
 * At a high speed, or when a replay is scrubbed across a busy spell, incidents
 * can arrive faster than they can be shown. A queue that only grew would end up
 * announcing a goal long after the match had moved on, so the oldest waiting
 * moments are dropped: the banner stays near the present, while always keeping
 * enough room for a pair like a foul and the card that follows it.
 */
const MAX_QUEUED = 4;

/** The one word for each incident kind. */
const INCIDENT_LABEL: Partial<Record<MatchSignalKind, string>> = {
  goal: 'GOAL',
  foul: 'FOUL',
  offside: 'OFFSIDE',
  'yellow-card': 'YELLOW CARD',
  'red-card': 'RED CARD',
};

export function MatchIncidentBanner({
  state,
  playerById,
}: {
  state: MatchRenderState;
  playerById: (id: string) => Player | undefined;
}) {
  const [incident, setIncident] = useState<MatchSignal | null>(null);
  // Every incident already accounted for — shown, or history from before the
  // banner appeared. Opening a match mid-game must not flash the goal that got
  // it there, so the record is seeded rather than queued on the first look.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(incidentsOf(state.signals).map((signal) => signal.id));
  // Incidents that have arrived but not yet had their turn on screen.
  const waiting = useRef<MatchSignal[]>([]);

  // A new minute is the only thing that can add an incident, so a change of
  // revision is the only thing worth reacting to.
  useEffect(() => {
    const fresh = newIncidents(seen.current!, state.signals);
    if (fresh.length === 0) return;
    for (const signal of fresh) seen.current!.add(signal.id);
    waiting.current.push(...fresh);
    if (waiting.current.length > MAX_QUEUED) waiting.current.splice(0, waiting.current.length - MAX_QUEUED);
    // Nothing on screen? Start the queue. If something is already showing, the
    // timer below will pick the next one up when its turn ends.
    setIncident((current) => current ?? waiting.current.shift() ?? null);
  }, [state.revision]);

  // Each incident holds the screen for its turn, then hands over to the next in
  // the queue — so two incidents in one minute are both read.
  useEffect(() => {
    if (!incident) return;
    const timer = window.setTimeout(() => setIncident(waiting.current.shift() ?? null), INCIDENT_MS);
    return () => window.clearTimeout(timer);
  }, [incident]);

  if (!incident) return null;
  const tone = incidentTone(incident.kind);
  if (!tone) return null;

  const team = incident.side ? state.teams[incident.side] : null;
  const player = incident.playerId ? playerById(incident.playerId) : undefined;
  const minute = minuteLabel(incident.minute, state.period === 'first-half');

  return (
    <div
      className={`incident incident--${tone}`}
      data-incident={incident.kind}
      role="status"
      aria-live="polite"
      style={team ? ({ '--incident-colour': team.colours.primary } as CSSProperties) : undefined}
    >
      <span className="incident__kind">{INCIDENT_LABEL[incident.kind] ?? incident.kind}</span>
      {player ? <span className="incident__player">{player.surname}</span> : null}
      <span className="incident__minute">{minute}&#39;</span>
    </div>
  );
}
