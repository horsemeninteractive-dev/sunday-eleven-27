/**
 * The changelog, read and understood.
 *
 * The project keeps one changelog, in the repository, in the format everybody
 * already knows. The game shows that same file rather than a second copy of the
 * history kept in the interface, so there is nothing to forget to update — and
 * this module is the small amount of understanding needed to render it: which
 * lines are versions, which are groups of changes, and which are the changes.
 *
 * It is deliberately not a markdown implementation. It reads the four things a
 * Keep a Changelog file is actually made of, and leaves the rest as words.
 */

export interface InlinePart {
  text: string;
  bold?: boolean;
  href?: string;
}

export type ChangeBlock =
  | { kind: 'title'; parts: InlinePart[] }
  | {
      kind: 'version';
      /** `0.1.0` where the heading gives one. */
      version: string | null;
      /** The date in the heading, if it carries one. */
      date: string | null;
      /** Everything else the heading says, e.g. the name of the release. */
      detail: string;
    }
  | { kind: 'section'; parts: InlinePart[] }
  | { kind: 'item'; parts: InlinePart[] }
  | { kind: 'paragraph'; parts: InlinePart[] };

const VERSION_IN_HEADING = /^\[([^\]]+)\]\s*(?:[-—–]\s*)?(.*)$/;
const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/;
const LINK = /\[([^\]]+)\]\(([^)]+)\)/;

/**
 * Bold and links, which is all the inline markup a changelog uses.
 *
 * Links are only kept when they point somewhere real: a changelog is read in a
 * game, and it should not be able to send the manager to a broken address or to
 * somewhere the project never published.
 */
export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  for (const chunk of text.split(/(\*\*[^*]+\*\*)/g)) {
    if (!chunk) continue;
    if (chunk.startsWith('**') && chunk.endsWith('**') && chunk.length > 4) {
      parts.push({ text: chunk.slice(2, -2), bold: true });
      continue;
    }
    const link = LINK.exec(chunk);
    if (link && /^https?:\/\//.test(link[2]!)) {
      const before = chunk.slice(0, link.index);
      const after = chunk.slice(link.index + link[0].length);
      if (before) parts.push({ text: before });
      parts.push({ text: link[1]!, href: link[2]! });
      if (after) parts.push({ text: after });
      continue;
    }
    parts.push({ text: chunk });
  }
  return parts.length > 0 ? parts : [{ text: '' }];
}

export function parseChangelog(markdown: string): ChangeBlock[] {
  const blocks: ChangeBlock[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('# ')) {
      blocks.push({ kind: 'title', parts: parseInline(trimmed.slice(2)) });
      continue;
    }
    if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
      const rest = trimmed.slice(3);
      const match = VERSION_IN_HEADING.exec(rest);
      const version = match ? match[1]!.trim() : null;
      const remainder = match ? match[2]!.trim() : rest;
      const date = ISO_DATE.exec(remainder);
      const detail = remainder
        .replace(ISO_DATE, '')
        .replace(/^[-—–\s]+/, '')
        .trim();
      blocks.push({ kind: 'version', version, date: date ? date[1]! : null, detail });
      continue;
    }
    if (trimmed.startsWith('### ')) {
      blocks.push({ kind: 'section', parts: parseInline(trimmed.slice(4)) });
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      blocks.push({ kind: 'item', parts: parseInline(trimmed.replace(/^[-*]\s+/, '')) });
      continue;
    }
    blocks.push({ kind: 'paragraph', parts: parseInline(trimmed) });
  }
  return blocks;
}
