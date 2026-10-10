import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MANAGER_PERSON_ID } from '@/domain/communication';
import type { FaceChoices } from '@/domain/face';
import { FACE_CHOICE_ROWS, facePlan, rolledFaceChoices, type FaceSubject } from '../face';
import { FACE_GROUPS, FaceDesigner, type FaceDesignerProps, type FaceGroupId } from './FaceDesigner';
import { PortraitArt, officialOutfit } from './Portrait';

/**
 * The customiser, as markup.
 *
 * What is pinned here is that the panel is the twelve features and the real
 * drawing, and nothing else: that a manager looking at it is looking at the same
 * portrait his own page will draw him, that every row says which of its buttons is
 * the one he has, and that the two buttons that offer him somebody else's face
 * appear only where there is something to offer them with. There is no DOM in
 * these tests — a server render is all the markup the game ever gets to inspect —
 * so what a *press* does is pinned at the bottom as the one line of source that
 * does it, which is the same line for all twelve rows.
 */

const SUBJECT: FaceSubject = { id: MANAGER_PERSON_ID, firstName: 'Dave', surname: 'Fletcher', age: 44 };

function draw(patch: Partial<FaceDesignerProps> = {}): string {
  return renderToStaticMarkup(
    createElement(FaceDesigner, { subject: SUBJECT, choices: rolledFaceChoices(SUBJECT), onChange: () => {}, ...patch }),
  );
}

/** The rows a tab holds, in the order they are drawn. */
function rowsOf(group: FaceGroupId) {
  return FACE_CHOICE_ROWS.filter((row) => FACE_GROUPS.find((entry) => entry.id === group)!.keys.includes(row.key));
}

/** One man, drawn as the designer draws him. */
function drawn(choices: FaceChoices): string {
  return renderToStaticMarkup(
    createElement(PortraitArt, { plan: facePlan({ ...SUBJECT, face: choices }), outfit: officialOutfit(), detail: 2 }),
  );
}

describe('the manager chooses his face', () => {
  it('draws the real portrait, at the size his own page gives him', () => {
    // Not a smaller copy of the drawing and not a second drawing that could drift
    // from it: the same `PortraitArt` a squad table renders, from the same
    // `facePlan`, in the profile's own box and an official's coat.
    const html = draw();
    expect(html).toContain('class="portrait portrait--xl"');
    expect(html).toContain(drawn(rolledFaceChoices(SUBJECT)));
  });

  it('sorts every feature a face is built out of into three tabs, one row each', () => {
    // Every row is in exactly one tab: a row in none would be a feature he cannot
    // reach, and a row in two would be drawn twice.
    expect(FACE_CHOICE_ROWS).toHaveLength(12);
    expect(FACE_GROUPS.flatMap((entry) => entry.keys).sort()).toEqual(FACE_CHOICE_ROWS.map((row) => row.key).sort());

    const html = draw();
    expect(html.match(/role="tab"/g)).toHaveLength(FACE_GROUPS.length);
    for (const entry of FACE_GROUPS) expect(html, entry.label).toContain(`${entry.label}</span>`);
    // Each tab draws its own rows, and only those, when it is the one open.
    for (const entry of FACE_GROUPS) {
      const open = draw({ initialGroup: entry.id });
      expect(open.match(/role="group"/g), entry.label).toHaveLength(entry.keys.length);
      for (const which of rowsOf(entry.id)) expect(open, which.label).toContain(`aria-label="${which.label}"`);
    }
  });

  it('shows the face he has, rather than a set of defaults', () => {
    // One pressed button per row in the open tab, and exactly one: a row with two
    // would be a face that is two faces, and a row with none would be a row that
    // has forgotten him.
    for (const entry of FACE_GROUPS) {
      const open = draw({ initialGroup: entry.id });
      expect(open.match(/aria-pressed="true"/g), entry.label).toHaveLength(entry.keys.length);
    }
    // And the row that is pressed is the one the drawing is actually using.
    const face = rolledFaceChoices(SUBJECT);
    const shape = FACE_CHOICE_ROWS.find((which) => which.key === 'shape')!;
    expect(draw()).toContain(`>${shape.options.find((option) => option.value === face.shape)!.label}<`);
  });

  it('puts the paint on the rows that are a colour, in the tab they belong to', () => {
    // A row of colour names is a row decided by reading; the chip is what lets the
    // eye choose one. It is drawn in the option's own paint, which is the same
    // paint the drawing is given — see `FACE_CHOICE_ROWS`.
    const chips = FACE_CHOICE_ROWS.flatMap((which) => which.options.filter((option) => option.colour));
    expect(chips.length).toBeGreaterThan(20);
    let drawnChips = 0;
    for (const entry of FACE_GROUPS) {
      const open = draw({ initialGroup: entry.id });
      const count = open.match(/class="facedesigner__dot"/g)?.length ?? 0;
      drawnChips += count;
      for (const which of rowsOf(entry.id)) for (const option of which.options) if (option.colour) expect(open).toContain(option.colour);
    }
    expect(drawnChips).toBe(chips.length);
    expect(draw()).toContain(`class="facedesigner__dot" style="background:${FACE_CHOICE_ROWS[1]!.options[0]!.colour!}"`);
  });

  it('draws what he picks rather than what his name rolled', () => {
    const rolled = rolledFaceChoices(SUBJECT);
    const which = FACE_CHOICE_ROWS.find((row) => row.key === 'hairStyle')!;
    const picked = which.options.find((option) => option.value !== rolled.hairStyle)!.value;
    const chosen = { ...rolled, hairStyle: picked } as FaceChoices;
    // Said out loud first, because the rest of this proves nothing if it is not so.
    expect(chosen).not.toEqual(rolled);

    const base = draw();
    const after = draw({ choices: chosen });
    expect(after).not.toBe(base);
    expect(after).toContain(drawn(chosen));
    expect(after).not.toContain(drawn(rolled));
  });

  it('offers him somebody else’s face only when it is given one to offer', () => {
    // Both are omitted on a screen with nothing to offer: the pre-game panel has no
    // career to roll a shuffle from, and no face of its own to put back.
    const bare = draw();
    expect(bare).not.toContain('Surprise me');
    expect(bare).not.toContain('As my name draws me');
    const shuffle = draw({ onShuffle: () => {} });
    expect(shuffle).toContain('Surprise me');
    // And the way back is offered only once there is something to go back from.
    expect(shuffle).not.toContain('As my name draws me');
    const both = draw({ onShuffle: () => {}, onReset: () => {} });
    expect(both).toContain('Surprise me');
    expect(both).toContain('As my name draws me');
  });

  it('says whether the face on screen is his own pick or the roll', () => {
    expect(draw({ chosen: false })).toContain('the face your name draws for you');
    expect(draw({ chosen: true })).toContain('Yours, and kept in the save with your name');
  });

  it('reads no career, and hands the whole face back with one feature moved', () => {
    // There is no DOM here, so what a press does is the source of the one line that
    // does it. Twelve rows are that one line, which is the point of the rows being
    // data: there is nowhere else for a row to be wired up differently.
    const source = readFileSync('src/ui/components/FaceDesigner.tsx', 'utf8');
    expect(source).toContain('onChange({ ...choices, [row.key]: value }');
    expect(source).toContain('aria-pressed={value === option.value}');
    expect(source).toContain('FACE_CHOICE_ROWS.filter');
    expect(source).toContain('facePlan({ ...subject, face: choices })');
    // A control that kept its own copy of the face would be a second version of the
    // truth, and the save would eventually disagree with the screen. Its only state
    // is which tab is open, so the one `useState` it has must be that and nothing else.
    expect(source).toContain('useState<FaceGroupId>(initialGroup)');
    expect(source).not.toContain('useState(choices');
    expect(source).not.toContain('useGameStore');
  });
});
