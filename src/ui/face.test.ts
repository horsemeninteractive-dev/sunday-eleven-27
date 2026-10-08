import { describe, expect, it } from 'vitest';
import { MANAGER_PERSON_ID } from '@/domain/communication';
import type { FaceChoices } from '@/domain/face';
import { isPlayer } from '@/domain/person';
import { generateDraft, startGameFromDraft } from '@/simulation/gameSetup';
import { createTestGame } from '@/simulation/testSupport';
import {
  BROW_LIFTS,
  BROW_WEIGHTS,
  FACE_CHOICE_ROWS,
  HEADS,
  facePlan,
  randomFaceChoices,
  rolledFaceChoices,
  type FaceChoiceOption,
  type FacePlan,
  type FaceSubject,
} from './face';

/**
 * A face can be chosen, and this is what that is allowed to mean.
 *
 * The generator is the floor and a choice is a coat of paint over it. Two
 * sentences hold the whole thing up:
 *
 *  - A man who picks *nothing* is drawn by exactly the numbers his name drew him
 *    by before any of this existed. Everybody but the manager picks nothing, so
 *    this is not a corner case — it is almost every face in the game, and every
 *    face in every save that predates the customiser.
 *
 *  - A man who picks *one* feature moves that feature and nothing else. The roll
 *    is never skipped and never reordered, so choosing a beard cannot shift a
 *    nose under it. That is what makes the panel a mirror rather than a re-roll.
 */

/** The manager's own subject: his fixed id, a name, and an age with no grey in it. */
const SUBJECT: FaceSubject = { id: MANAGER_PERSON_ID, firstName: 'Dave', surname: 'Fletcher', age: 24 };

/** The one part of a plan a row is allowed to move, as a path into it. */
const MOVES: Record<keyof FaceChoices, string[]> = {
  shape: ['shape', 'head'],
  skin: ['skin'],
  hair: ['hair'],
  hairStyle: ['hairStyle'],
  beard: ['beard'],
  glasses: ['glasses'],
  eyeColour: ['eyes.colour'],
  eyeShape: ['eyes.shape'],
  browWeight: ['brows.weight'],
  browLift: ['brows.lift'],
  nose: ['nose'],
  mouth: ['mouth'],
};

/** What the plan says about a feature, and what the row says it should say. */
const READ: Record<keyof FaceChoices, (plan: FacePlan) => unknown> = {
  shape: (plan) => plan.shape,
  skin: (plan) => plan.skin.fill,
  hair: (plan) => plan.hair.fill,
  hairStyle: (plan) => plan.hairStyle,
  beard: (plan) => plan.beard,
  glasses: (plan) => plan.glasses,
  eyeColour: (plan) => plan.eyes.colour,
  eyeShape: (plan) => plan.eyes.shape,
  browWeight: (plan) => plan.brows.weight,
  browLift: (plan) => plan.brows.lift,
  nose: (plan) => plan.nose,
  mouth: (plan) => plan.mouth,
};

const WANT: Record<keyof FaceChoices, (option: FaceChoiceOption) => unknown> = {
  // A colour row's option carries the paint, which is the same paint the palette
  // would have given the same name — see the look-ups in `face.ts`.
  shape: (option) => option.value,
  skin: (option) => option.colour,
  hair: (option) => option.colour,
  hairStyle: (option) => option.value,
  beard: (option) => option.value,
  glasses: (option) => option.value,
  eyeColour: (option) => option.colour,
  eyeShape: (option) => option.value,
  browWeight: (option) => BROW_WEIGHTS.find((entry) => entry.id === option.value)!.value,
  browLift: (option) => BROW_LIFTS.find((entry) => entry.id === option.value)!.value,
  nose: (option) => option.value,
  mouth: (option) => option.value,
};

/** The row for a key, and one of its options by value. */
const row = (key: keyof FaceChoices) => FACE_CHOICE_ROWS.find((candidate) => candidate.key === key)!;
const option = (key: keyof FaceChoices, value: string | boolean) =>
  row(key).options.find((candidate) => candidate.value === value)!;

/** The plan with the parts a choice was allowed to touch taken out of it. */
function without(plan: FacePlan, paths: string[]): FacePlan {
  const copy = structuredClone(plan) as unknown as Record<string, unknown>;
  for (const path of paths) {
    const parts = path.split('.');
    let at = copy;
    for (const part of parts.slice(0, -1)) at = at[part] as Record<string, unknown>;
    delete at[parts[parts.length - 1]!];
  }
  return copy as unknown as FacePlan;
}

describe('a face can be chosen', () => {
  it('draws a man who picked nothing exactly as the roll drew him', () => {
    // The generator's half of the contract, in the only form a test can hold it:
    // picking back everything the roll said has to be picking nothing. A change
    // that made a choice shift the numbers under it would fail here for every man
    // in the game at once, because every one of them is drawn through this path.
    const subjects: FaceSubject[] = [
      SUBJECT,
      { ...SUBJECT, age: 41 },
      { ...SUBJECT, age: 64 },
      { id: 'p1', firstName: 'Kev', surname: 'Bramble', age: 29 },
      { id: 'p2', firstName: 'Aisha', surname: 'Okoro', age: 33 },
    ];
    for (const subject of subjects) {
      const rolled = facePlan(subject);
      expect(facePlan({ ...subject, face: rolledFaceChoices(subject) }), `${subject.firstName} ${subject.surname}`).toEqual(rolled);
    }
  });

  it('moves the feature a row picks, and nothing else on the face', () => {
    // Twelve rows and every option on every one of them: the feature he picked is
    // the feature on the drawing, and every other feature — and both of the
    // measurements that are not features — are the ones the roll gave him.
    const base = facePlan(SUBJECT);
    for (const which of FACE_CHOICE_ROWS) {
      for (const pick of which.options) {
        const choices = { ...rolledFaceChoices(SUBJECT), [which.key]: pick.value } as FaceChoices;
        const after = facePlan({ ...SUBJECT, face: choices });
        expect(READ[which.key](after), `${which.label} → ${pick.label}`).toBe(WANT[which.key](pick));
        expect(without(after, MOVES[which.key]), `${which.label} → ${pick.label} moved something else`).toEqual(
          without(base, MOVES[which.key]),
        );
      }
    }
  });

  it('offers a row for every feature a face has, and for nothing else', () => {
    // The rows are the customiser's whole vocabulary, so if a decision were ever
    // added to the roll and not to the rows it would be a feature the manager could
    // not change and could not even see — and this is where that shows up.
    expect(FACE_CHOICE_ROWS.map((which) => which.key).sort()).toEqual(Object.keys(rolledFaceChoices(SUBJECT)).sort());
    expect(FACE_CHOICE_ROWS).toHaveLength(12);
    // Every row offers at least two things to choose between, or it is not a row.
    for (const which of FACE_CHOICE_ROWS) expect(which.options.length, which.label).toBeGreaterThan(1);
  });

  it('never lets a choice move the two measurements nobody picks about himself', () => {
    // How far apart the eyes are and how high they sit are the generator's, and
    // they are deliberately not in the rows. They ride along with the choices
    // because they are drawn from the same stream in the same pass, which is
    // exactly why they need saying out loud.
    const base = facePlan(SUBJECT);
    let choices = rolledFaceChoices(SUBJECT);
    for (const which of FACE_CHOICE_ROWS) {
      choices = { ...choices, [which.key]: which.options[which.options.length - 1]!.value } as FaceChoices;
    }
    const after = facePlan({ ...SUBJECT, face: choices });
    expect(after.eyes.spacing).toBe(base.eyes.spacing);
    expect(after.eyes.height).toBe(base.eyes.height);
    expect(after.grey).toBe(base.grey);
  });

  it('greys the colour he picked, because a man ages and a save file does not', () => {
    // Age is the one thing a choice cannot override: the strongest reading of the
    // customiser is that a fifty-year-old could give himself a schoolboy's hair,
    // and he cannot. He can choose the colour; his age decides how much grey is
    // over the top of it, exactly as it would if he had chosen nothing.
    const young = { ...SUBJECT, age: 24 };
    const old = { ...SUBJECT, age: 64 };
    const black: FaceChoices = { ...rolledFaceChoices(young), hair: 'black' };
    const blackPaint = option('hair', 'black').colour!;
    expect(facePlan({ ...young, face: black }).hair.fill).toBe(blackPaint);

    const greyed = facePlan({ ...old, face: black });
    expect(greyed.grey).toBeGreaterThan(0.3);
    expect(greyed.hair.fill).not.toBe(blackPaint);
    // How grey he is belongs to the roll, not to the colour he chose: the same man
    // with no choice at all greys by the same amount.
    expect(greyed.grey).toBe(facePlan(old).grey);
  });

  it('only ever rolls a face the customiser can show as pressed', () => {
    // A row whose feature is set to something no button stands for would be a
    // panel showing a man a face he cannot see the state of — and it would happen
    // silently, because the drawing would still be right. Every man in a real world
    // is checked, and every shuffle the button offers: a roll that landed on a
    // value outside the rows would fail here whichever half of `face.ts` caused it.
    const { state } = createTestGame('faces-representable');
    const people = Object.values(state.people);
    expect(people.length).toBeGreaterThan(500);

    const check = (faces: FaceChoices, who: string) => {
      for (const which of FACE_CHOICE_ROWS) {
        const value = faces[which.key];
        expect(
          which.options.some((candidate) => candidate.value === value),
          `${who} rolls ${which.label} = ${String(value)}, which is not on the row`,
        ).toBe(true);
      }
    };

    for (const person of people) check(rolledFaceChoices(person), `${person.firstName} ${person.surname}`);
    for (const name of ['walnut', 'haddock', 'tuesday', 'orchard', 'lantern', 'the old canal', 'meadow end', 'brass']) {
      check(randomFaceChoices(name, 38), name);
    }
  });

  it('gives a different face from a different name, and the same face from the same one', () => {
    // The button is a way of being handed somebody else's face, so a shuffle that
    // kept handing back this one would be a button that does nothing. It is drawn
    // from invented words rather than from dice, so it is still a roll of a stream
    // and still the same face every time it is asked for the same words.
    const first = randomFaceChoices('walnut', 38);
    expect(randomFaceChoices('walnut', 38)).toEqual(first);
    const names = ['walnut', 'haddock', 'tuesday', 'orchard', 'lantern', 'church', 'canal', 'meadow'];
    const faces = names.map((name) => JSON.stringify(randomFaceChoices(name, 38)));
    expect(new Set(faces).size).toBe(names.length);
    // And the age still has the last word on the shuffle: hair thins with it.
    for (const name of names) {
      expect(randomFaceChoices(name, 24)).not.toEqual(randomFaceChoices(name, 58));
    }
  });

  it('draws the same face on the setup screen and in the career it starts', () => {
    // The promise the pre-game panel makes. `ProfileView` draws the manager from
    // three facts — his fixed id, his name as it will be trimmed, and the age his
    // birthday gives him on the day the career begins — and the career has to draw
    // him from exactly the same three, or the face a manager spends a minute
    // choosing is not the face he gets. He is the only person in the game whose
    // name the player types, which is the whole reason the roll is seeded with it.
    const draft = generateDraft({ seed: 'face-preview' });
    const clubId = draft.divisionClubIds[0]!;
    const face = randomFaceChoices('a face off the wall', 41);
    const state = startGameFromDraft(draft, {
      seed: draft.seed,
      clubId,
      saveName: 'Preview',
      manager: {
        firstName: '  Dave  ',
        surname: 'Fletcher',
        nickname: '',
        birthday: '1978-03-02',
        occupation: 'Scaffolder',
        hometown: '',
        face,
      },
    });

    const manager = state.people[MANAGER_PERSON_ID]!;
    // What the setup screen would have drawn: trimmed name, birthday age, chosen face.
    const onTheSetupScreen = { id: MANAGER_PERSON_ID, firstName: 'Dave', surname: 'Fletcher', age: manager.age, face };
    expect(facePlan(manager)).toEqual(facePlan(onTheSetupScreen));

    // Now the same man with nothing chosen at all, which is the case that has to
    // keep working for every career already on somebody's disk: the name alone
    // decides, and it decides the same way on both screens.
    const plain = startGameFromDraft(draft, {
      seed: draft.seed,
      clubId,
      saveName: 'Plain',
      manager: { firstName: 'Dave', surname: 'Fletcher', nickname: '', birthday: '1978-03-02', occupation: '', hometown: '' },
    });
    const plainManager = plain.people[MANAGER_PERSON_ID]!;
    expect(plainManager.face).toBeUndefined();
    expect(facePlan(plainManager)).toEqual(
      facePlan({ id: MANAGER_PERSON_ID, firstName: 'Dave', surname: 'Fletcher', age: plainManager.age }),
    );
  });

  it('draws a chosen head out of the same six skulls as everybody else', () => {
    // The choice names a shape rather than carrying a geometry, which is what keeps
    // the two halves honest: a square jaw on the customiser is the same geometry a
    // square jaw has anywhere else, so the hair fits it for the same reason.
    for (const which of row('shape').options) {
      const shape = which.value as keyof typeof HEADS;
      const plan = facePlan({ ...SUBJECT, face: { ...rolledFaceChoices(SUBJECT), shape } });
      expect(plan.head).toEqual(HEADS[shape]);
    }
  });

  it('is a person, not a record: a chosen face survives a change of club', () => {
    // The manager is the only man in the game with a chosen face today, but a face
    // is a fact about a man and not about a shirt, and the customiser is the first
    // code that could have broken that.
    const { state } = createTestGame('face-choices-stay');
    const player = Object.values(state.people).find(isPlayer)!;
    const rolled = rolledFaceChoices(player);
    // A cut he did not roll, so that the comparison below is saying something.
    const picked = row('hairStyle').options.find((candidate) => candidate.value !== rolled.hairStyle)!.value;
    const chosen: FaceChoices = { ...rolled, hairStyle: picked, glasses: true } as FaceChoices;
    const bare = facePlan({ ...player, face: undefined });
    const drawn = facePlan({ ...player, face: chosen });
    expect(drawn).not.toEqual(bare);
    expect(drawn.eyes.spacing).toBe(bare.eyes.spacing);
    expect(drawn.hairStyle).toBe(picked);
    expect(drawn.glasses).toBe(true);
  });
});
