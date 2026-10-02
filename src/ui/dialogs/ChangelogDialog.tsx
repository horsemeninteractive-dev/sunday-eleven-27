import changelogRaw from '../../../CHANGELOG.md?raw';
import { parseChangelog, type ChangeBlock, type InlinePart } from '../changelog';
import { gameActions } from '../hooks';
import { versionLabel } from '@/version';
import { Dialog } from './Dialog';

/**
 * The changelog the game ships with, read from the project's own changelog so
 * there is only ever one history to keep. It is the honest answer to "what has
 * changed?", which matters more than usual in a beta.
 */

function parts(parts: InlinePart[]) {
  return parts.map((part, index) =>
    part.href ? (
      <a key={index} href={part.href} target="_blank" rel="noreferrer noopener">
        {part.text}
      </a>
    ) : part.bold ? (
      <strong key={index}>{part.text}</strong>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  );
}

export function ChangelogDialog() {
  const blocks = parseChangelog(changelogRaw);
  const latestVersion = blocks.find((block) => block.kind === 'version' && block.version);
  const latest = latestVersion && latestVersion.kind === 'version' ? latestVersion.version : null;

  // The first version heading in the file is the build in front of him, and it
  // is worth saying so: in a beta, knowing which side of a change you are on is
  // the difference between a bug and a missing feature.
  let seenFirstVersion = false;

  return (
    <Dialog
      title="Changelog"
      subtitle={versionLabel()}
      narrow
      onClose={() => gameActions().closeDialog()}
    >
      <article className="changelog">
        {blocks.map((block: ChangeBlock, index: number) => {
          if (block.kind === 'title') return null;
          if (block.kind === 'version') {
            const current = !seenFirstVersion;
            seenFirstVersion = true;
            return (
              <h3 className={`changelog__version${current ? ' changelog__version--current' : ''}`} key={index}>
                <span className="changelog__number">{block.version ? `v${block.version}` : 'Unreleased'}</span>
                {current && latest && block.version === latest && <span className="pill pill--accent">this build</span>}
                {block.date && <span className="muted small">{block.date}</span>}
                {block.detail && <span className="changelog__name">{block.detail}</span>}
              </h3>
            );
          }
          if (block.kind === 'section') return <h4 className="changelog__section" key={index}>{parts(block.parts)}</h4>;
          if (block.kind === 'item') {
            return (
              <p className="changelog__item" key={index}>
                <span className="changelog__bullet" aria-hidden="true">
                  ·
                </span>
                {/* The bullet and the text are the item's only two grid cells.
                    Rendering the parts as siblings put every part after the
                    first into the 12px bullet column, so a bullet with a bold
                    lead-in and some words after it wrapped one word per line. */}
                <span className="changelog__text">{parts(block.parts)}</span>
              </p>
            );
          }
          return (
            <p className="small muted" key={index}>
              {parts(block.parts)}
            </p>
          );
        })}
      </article>
    </Dialog>
  );
}
