import { MatchPitch } from '@/ui/match/MatchPitch';
import type { MatchRendererDefinition, MatchRendererProps, RendererKind } from './renderContract';

/**
 * The renderer registry.
 *
 * The one place that knows which renderers exist and which of them are built.
 * `MatchView` asks it for the manager's chosen renderer and mounts what it is
 * given; nothing else in the app names a renderer directly. To add 3D, build a
 * component that satisfies {@link MatchRendererProps}, point the `3d` entry at
 * it and set `available: true`. No simulation file changes, because none of them
 * know a renderer exists.
 */

/**
 * What a renderer shows before it is built.
 *
 * Deliberately not a stub of the match: while `available` is false the registry
 * never hands this out, so selecting 3D before 3D exists falls back to the pitch
 * rather than to a hole. It exists only so a half-finished renderer fails
 * visibly instead of silently drawing nothing.
 */
function PendingRenderer({ state }: MatchRendererProps) {
  void state;
  return (
    <div className="pitch pitch--live matchpitch" data-renderer="3d">
      <p className="muted">This renderer is not built yet.</p>
    </div>
  );
}

export const MATCH_RENDERERS: Record<RendererKind, MatchRendererDefinition> = {
  '2d': {
    kind: '2d',
    label: '2D pitch',
    description: 'The manager-eye view: players and the ball on a flat pitch.',
    available: true,
    Component: MatchPitch,
  },
  '3d': {
    kind: '3d',
    label: '3D pitch',
    description: 'A camera in the ground. Not built yet — choosing it falls back to 2D.',
    available: false,
    Component: PendingRenderer,
  },
};

/**
 * The renderer to mount for a chosen kind.
 *
 * A renderer that is chosen but not built resolves to 2D, so a preference can
 * name the future without the present breaking on it.
 */
export function resolveRenderer(kind: RendererKind): MatchRendererDefinition {
  const chosen = MATCH_RENDERERS[kind];
  if (chosen && chosen.available && chosen.Component) return chosen;
  return MATCH_RENDERERS['2d'];
}
