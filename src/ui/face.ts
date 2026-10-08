import type {
  BeardStyle,
  BrowLift,
  BrowWeight,
  EyeColourId,
  EyeShape,
  FaceChoices,
  FaceShape,
  HairColourId,
  HairStyle,
  MouthShape,
  NoseShape,
  SkinToneId,
} from '@/domain/face';
import { stream, type WeightedEntry } from '@/simulation/rng';
import { mixColours } from './colour';

// The vocabulary is the domain's, because a saved career holds it — see
// `domain/face.ts`. Re-exported here so everything that draws a face can still
// reach it in one import, next to the palette it is painted from.
export type {
  BeardStyle,
  BrowLift,
  BrowWeight,
  EyeColourId,
  EyeShape,
  FaceChoices,
  FaceShape,
  HairColourId,
  HairStyle,
  MouthShape,
  NoseShape,
  SkinToneId,
};

/**
 * Faces.
 *
 * The game carries a substantial model of people — a squad of eighteen, a
 * committee, the manager, the scouts, the other dugout — and for years all of
 * them were drawn with the same item: one bust glyph in one grey box. A squad
 * list was the same record eighteen times, and the only thing telling two rows
 * apart was reading the name beside them. Letters were tried next and were
 * worse, because a pair of initials in a square is the visual grammar of a
 * database: a serial number wearing a hat.
 *
 * So the game draws a man. Not a photograph and not a portrait of a real
 * person, but the same kind of invented drawing it already trusts for crests,
 * kits and kit makers' marks: a head and a pair of shoulders built out of a
 * dozen legible decisions — how wide the jaw is, where the hairline sits, which
 * way the fringe falls, whether there are glasses on the nose.
 *
 * Everything here is a *plan*. `components/Portrait.tsx` is what turns a plan
 * into SVG, exactly as `badge.ts` and `components/Badge.tsx` split the same job
 * for crests — so the decisions can be read, weighed and tested without a
 * browser, and the drawing can be redrawn without moving any of them.
 *
 * Four rules hold the whole thing together:
 *
 *  - A face belongs to a man, not to a record. The plan is drawn from a
 *    generator seeded with his *name*, so the same man is the same face in the
 *    squad, in the committee, in the training list and in a name found through
 *    the local game — and stays that face if he transfers, retires or turns up
 *    again three seasons later in another club's shirt. Nothing about the club
 *    is read here at all: the club only ever changes the shirt, which is
 *    `Portrait.tsx`'s business, so a transfer cannot move a man's nose.
 *
 *  - A face is a fact about his age. Not a number drawn from nowhere: hair
 *    thins from the late thirties and greys from the forties, because the game
 *    already knows how old everybody is and a committee of sixty-year-olds who
 *    all had the same hair as the eighteen-year-olds was the giveaway that the
 *    drawing was a glyph.
 *
 *  - A face can be *chosen*, which is an override of the roll and not a
 *    replacement for it. The manager is the one man in the game whose face he
 *    has to look at every week, so he gets to pick it — see `FaceChoices` — and
 *    a career holds the features he picked beside the details he typed. What he
 *    does not pick still comes from his own roll, and a man who picks nothing is
 *    drawn exactly as his name rolls him. The roll itself is never skipped: the
 *    numbers are all drawn whether or not they are used, so choosing one feature
 *    cannot shift the rest of the face underneath it.
 *
 *  - Nothing here is anybody. There is no likeness database to match against:
 *    the shapes are geometric and the palette is broad on purpose, so the local
 *    game looks like the local game rather than like one street of it.
 */

/* ------------------------------------------------------------------- the box */

/**
 * The drawing's box: 56 wide by 64 tall, the shape of a portrait crop rather
 * than a square — head, neck and the top of the shoulders, which is all anybody
 * ever sees of a footballer in the paperwork.
 *
 * Everything below is in these units, and the stylesheet scales the box: 28x32
 * in a squad table, 105x120 on a profile. The ratio matters, so it is exported
 * for the sheet's tests to check each size against.
 */
export const PORTRAIT_WIDTH = 56;
export const PORTRAIT_HEIGHT = 64;

/** The middle of the head. Everything is measured from here and mirrored. */
export const FACE_CENTRE_X = 28;

/**
 * Where a face is drawn from.
 *
 * A person, or the details of one who does not exist yet — which is the whole
 * reason this is a shape of its own rather than `Person`: the manager's face is
 * chosen on a screen that runs *before* the world is built, so there is no
 * person record to draw from and there cannot be one. Five facts are all a roll
 * needs: who he is by name, how old he is, and the features he picked.
 */
export interface FaceSubject {
  id: string;
  firstName: string;
  surname: string;
  age: number;
  /** The features he chose. Absent means "as his own name rolls him". */
  face?: FaceChoices;
}

/* ------------------------------------------------------------------- the skin */

/**
 * A colour a face is painted in.
 *
 * The paint and nothing else: a plan is what the drawing reads, and what the
 * drawing needs is the two hexes. The name a man chose it by belongs to the
 * palette and to the customiser's buttons, not to the outline of his jaw.
 */
export interface FacePaint {
  fill: string;
  /** The same colour a shade or two down, for the edges and the undersides. */
  shade: string;
}

export interface SkinTone extends FacePaint {
  /** The name a man picks this tone by. See `SkinToneId`. */
  id: SkinToneId;
  label: string;
}

/**
 * Skin, from the palest to the deepest, weighted toward the middle.
 *
 * A grassroots English Sunday league is a broad crowd and the palette has to
 * say so: nine tones and no default. Each tone carries its own shade rather
 * than being darkened at the point of use, because darkening a colour that is
 * already dark turns a face into a silhouette, and a man's jaw should still be
 * a jaw.
 *
 * The weights are the generator's, and the order is the order the customiser
 * offers them in — palest first, because that is how a rack of anything is
 * laid out. Neither may be reordered without thinking about it: the weights are
 * what the roll reads, so moving a tone changes which tone a given roll lands
 * on, and every man in every existing save along with it.
 */
const SKIN_TONES: Array<WeightedEntry<SkinTone>> = [
  { value: { id: 'porcelain', label: 'Porcelain', fill: '#f7dcc8', shade: '#e3bda0' }, weight: 9 },
  { value: { id: 'fair', label: 'Fair', fill: '#f0cfae', shade: '#d9b088' }, weight: 12 },
  { value: { id: 'light', label: 'Light', fill: '#e8bd95', shade: '#d0a077' }, weight: 14 },
  { value: { id: 'warm', label: 'Warm', fill: '#d9a273', shade: '#be8353' }, weight: 13 },
  { value: { id: 'olive', label: 'Olive', fill: '#c68a5b', shade: '#a86c3f' }, weight: 11 },
  { value: { id: 'tan', label: 'Tan', fill: '#a86a3f', shade: '#8b5028' }, weight: 9 },
  { value: { id: 'bronze', label: 'Bronze', fill: '#8c5330', shade: '#6f3d1f' }, weight: 7 },
  { value: { id: 'brown', label: 'Brown', fill: '#6d3f24', shade: '#553017' }, weight: 5 },
  { value: { id: 'deep', label: 'Deep', fill: '#4f2c19', shade: '#3c2112' }, weight: 3 },
];

/* ------------------------------------------------------------------- the hair */

export interface HairColour extends FacePaint {
  /** The name a man picks this colour by. See `HairColourId`. */
  id: HairColourId;
  label: string;
}

const HAIR_COLOURS: Array<WeightedEntry<HairColour>> = [
  { value: { id: 'black', label: 'Black', fill: '#1b1512', shade: '#0d0a08' }, weight: 14 },
  { value: { id: 'dark-brown', label: 'Dark brown', fill: '#2f2319', shade: '#1c150f' }, weight: 14 },
  { value: { id: 'brown', label: 'Brown', fill: '#4a3623', shade: '#32251a' }, weight: 14 },
  { value: { id: 'chestnut', label: 'Chestnut', fill: '#6b4c2a', shade: '#4d3720' }, weight: 11 },
  { value: { id: 'auburn', label: 'Auburn', fill: '#8a5c2b', shade: '#684420' }, weight: 8 },
  { value: { id: 'sandy', label: 'Sandy', fill: '#b3873f', shade: '#8b662c' }, weight: 6 },
  { value: { id: 'fair', label: 'Fair', fill: '#cfa95f', shade: '#a6853e' }, weight: 3 },
  { value: { id: 'ginger', label: 'Ginger', fill: '#8f4a1c', shade: '#6c3814' }, weight: 3 },
];

/** What the grey in a man's hair is made of. Never pure white: nobody is. */
const GREY = '#c6c9cb';

/**
 * The cut. Nine of them, and between them they are most of a Sunday morning on
 * any touchline in the county: the ones who still have it, the ones who are
 * losing it, and the ones who never had it.
 *
 * The union in `domain/face.ts` is the order the customiser offers; this list is
 * the order they are read in, and the two are the same on purpose.
 */
export const HAIR_STYLES: HairStyle[] = [
  'bald',
  'receding',
  'buzz',
  'crop',
  'fringe',
  'side',
  'curls',
  'afro',
  'long',
];

const HAIR_STYLE_WEIGHTS: Array<WeightedEntry<HairStyle>> = [
  { value: 'crop', weight: 28 },
  { value: 'buzz', weight: 15 },
  { value: 'side', weight: 12 },
  { value: 'fringe', weight: 12 },
  { value: 'curls', weight: 12 },
  { value: 'receding', weight: 6 },
  { value: 'afro', weight: 6 },
  { value: 'long', weight: 4 },
  { value: 'bald', weight: 2 },
];

/* ------------------------------------------------------------------ the beard */

export const BEARD_STYLES: BeardStyle[] = ['none', 'stubble', 'moustache', 'goatee', 'beard'];

const BEARD_WEIGHTS: Array<WeightedEntry<BeardStyle>> = [
  { value: 'none', weight: 30 },
  { value: 'stubble', weight: 30 },
  { value: 'moustache', weight: 7 },
  { value: 'goatee', weight: 11 },
  { value: 'beard', weight: 20 },
];

/* --------------------------------------------------------------- the features */

export const FACE_SHAPES: FaceShape[] = ['oval', 'long', 'round', 'square', 'heart', 'broad'];

/**
 * A head, as five numbers.
 *
 * The generator never stores a path: it stores the *shape* of one and the
 * drawing builds the outline from it. That is what lets the hair fit every
 * face — a fringe that knew only its own coordinates would hang off a narrow
 * skull and cut into a broad one — and it means a new face shape is a line of
 * numbers rather than a new drawing.
 */
export interface HeadGeometry {
  /** Half the width of the skull at the temples, in the 56-wide box. */
  half: number;
  /** Y of the top of the skull. */
  crown: number;
  /** Y of the point of the chin. */
  chin: number;
  /** How wide the jaw is at its corner, as a share of `half`. */
  jaw: number;
  /** The chin: 0 is a point, 1 is a flat bar. */
  chinFlat: number;
}

/**
 * Six skulls, measured to sit in the box with room for hair and shoulders
 * around them. `crown` and `chin` move by a couple of units between them, which
 * is the whole difference between a long face and a round one — a man's face is
 * 1.3 times as tall as it is wide, and the ones who are not are the ones the
 * eye notices.
 */
export const HEADS: Record<FaceShape, HeadGeometry> = {
  oval: { half: 13.2, crown: 6.4, chin: 42.2, jaw: 0.72, chinFlat: 0 },
  long: { half: 12.4, crown: 5.8, chin: 43.6, jaw: 0.74, chinFlat: 0.15 },
  round: { half: 14.8, crown: 7.4, chin: 39.6, jaw: 0.88, chinFlat: 0.6 },
  square: { half: 14.2, crown: 6.8, chin: 40.8, jaw: 0.96, chinFlat: 1 },
  heart: { half: 13.8, crown: 6.2, chin: 43, jaw: 0.6, chinFlat: 0 },
  broad: { half: 15.6, crown: 7.2, chin: 41.4, jaw: 0.9, chinFlat: 0.4 },
};

const HEAD_WEIGHTS: Array<WeightedEntry<FaceShape>> = [
  { value: 'oval', weight: 26 },
  { value: 'round', weight: 20 },
  { value: 'square', weight: 20 },
  { value: 'long', weight: 12 },
  { value: 'broad', weight: 12 },
  { value: 'heart', weight: 10 },
];

export const EYE_SHAPES: EyeShape[] = ['round', 'almond', 'narrow'];
export const NOSE_SHAPES: NoseShape[] = ['small', 'straight', 'broad', 'long'];
export const MOUTH_SHAPES: MouthShape[] = ['thin', 'straight', 'full', 'smile'];

/**
 * The brows, as the drawing's own multipliers.
 *
 * The three weights and the three lifts are the numbers `components/Portrait.tsx`
 * scales a brow by, so the choice and the drawing cannot drift apart: the
 * generator rolls the *name*, and this is the only place the number it stands
 * for is written down.
 */
export const BROW_WEIGHTS: Array<{ id: BrowWeight; label: string; value: number }> = [
  { id: 'fine', label: 'Fine', value: 0.9 },
  { id: 'normal', label: 'Normal', value: 1.3 },
  { id: 'heavy', label: 'Heavy', value: 1.9 },
];

export const BROW_LIFTS: Array<{ id: BrowLift; label: string; value: number }> = [
  { id: 'low', label: 'Low', value: -0.7 },
  { id: 'level', label: 'Level', value: 0 },
  { id: 'high', label: 'High', value: 0.55 },
];

/**
 * Eye colours, in roughly the proportions an English county sees them.
 *
 * A palette rather than a roll of dice: the point of a face at 28 pixels is
 * that it is *his*, and the eye colour is the one feature a manager will name
 * when he is describing a player to somebody else.
 *
 * The repeats are the weights, and they are load-bearing: this is read by
 * `pick`, not by `weighted`, so a colour appearing twice is a colour rolled
 * twice as often. Replacing the repeats with weights would change which colour
 * every roll lands on, and hand every man in every existing save a new pair of
 * eyes. The options below are the same colours listed once each, which is what
 * the customiser offers and what the roll's answer is looked up against.
 */
const EYE_COLOURS: string[] = [
  '#3a2a1c',
  '#5a3c22',
  '#5a3c22',
  '#7a5a2c',
  '#3f5a3a',
  '#3c5a72',
  '#3c5a72',
  '#6b7378',
];

export const EYE_COLOURS_BY_ID: Array<{ id: EyeColourId; label: string; fill: string }> = [
  { id: 'dark-brown', label: 'Dark brown', fill: '#3a2a1c' },
  { id: 'brown', label: 'Brown', fill: '#5a3c22' },
  { id: 'hazel', label: 'Hazel', fill: '#7a5a2c' },
  { id: 'green', label: 'Green', fill: '#3f5a3a' },
  { id: 'blue', label: 'Blue', fill: '#3c5a72' },
  { id: 'grey', label: 'Grey', fill: '#6b7378' },
];

export interface FacePlan {
  head: HeadGeometry;
  shape: FaceShape;
  skin: FacePaint;
  hair: FacePaint;
  hairStyle: HairStyle;
  beard: BeardStyle;
  eyes: { colour: string; shape: EyeShape; spacing: number; height: number };
  brows: { weight: number; lift: number };
  nose: NoseShape;
  mouth: MouthShape;
  glasses: boolean;
  /** 0 is his own colour, 1 is fully grey. A man greys; a file does not. */
  grey: number;
}

/* ------------------------------------------------------------- the look-ups */

/**
 * A palette value by name.
 *
 * The customiser holds names — `'afro'`, `'ginger'` — and the drawing needs the
 * paint, so the two halves meet here. Each of these is the exact entry the roll
 * would have produced for the same name, which is what makes a face that has
 * been echoed back unchanged identical to the face the roll drew.
 */
function skinToneFor(id: SkinToneId): SkinTone {
  return SKIN_TONES.find((entry) => entry.value.id === id)!.value;
}

function hairColourFor(id: HairColourId): HairColour {
  return HAIR_COLOURS.find((entry) => entry.value.id === id)!.value;
}

function eyeColourFor(id: EyeColourId): string {
  return EYE_COLOURS_BY_ID.find((entry) => entry.id === id)!.fill;
}

function eyeColourIdOf(fill: string): EyeColourId {
  // Every colour the roll can return is in the option list; the repeats map to
  // the same name, which is the point of listing them once.
  return EYE_COLOURS_BY_ID.find((entry) => entry.fill === fill)?.id ?? 'brown';
}

function browWeightValue(id: BrowWeight): number {
  return BROW_WEIGHTS.find((entry) => entry.id === id)!.value;
}

function browLiftValue(id: BrowLift): number {
  return BROW_LIFTS.find((entry) => entry.id === id)!.value;
}

/* --------------------------------------------------------------- the numbers */

/**
 * What the roll decided, features and measurements together.
 *
 * The measurements are not choices and never will be: how far apart a man's
 * eyes are and how high they sit are the two things nobody picks about their
 * own face and everybody notices about somebody else's, so they stay the
 * generator's business. They ride along with the choices because they are drawn
 * from the same stream in the same pass — see `facePlan` for why that matters.
 */
interface FaceRoll {
  choices: FaceChoices;
  /** The distance between the eyes, as a share of the half-width. */
  spacing: number;
  /** How far down the head the eyes sit, between crown and chin. */
  height: number;
  /** 0 is his own colour, 1 is fully grey. */
  grey: number;
}

/**
 * The roll, and the only place a face is invented.
 *
 * The order of the draws is a contract, not a preference. The generator is
 * deterministic and a plan has to be reproducible, so adding a decision in the
 * middle of this list would hand every man in every save a new face; new
 * decisions go on the end. Changing a *weight* is the same kind of decision and
 * is why the palettes carry their own weights rather than being re-weighted at
 * the point of use.
 *
 * Every number is drawn even when `subject.face` names a feature it will not
 * use, which is the other half of the same contract: skipping a draw would
 * shift everything after it, so choosing a beard would move a man's nose.
 */
function rollFace(subject: FaceSubject): FaceRoll {
  // Seeded with the name, not the id.
  //
  // The manager is one person in the whole game with a fixed id — a career's
  // own manager is `user_manager` whoever he is — so an id-seeded face would
  // give every manager of every save the same head, which is the one person in
  // the game the manager *does* pick the name of. Seeded with the name, the man
  // you named gets the face you named, and a squad of generated players is
  // still as varied as the generator made their names.
  const rng = stream(`${subject.id}::${subject.firstName}::${subject.surname}`, 'face');

  const skin = rng.weighted(SKIN_TONES);
  const hairColour = rng.weighted(HAIR_COLOURS);
  const headShape = rng.weighted(HEAD_WEIGHTS);

  // Hair, and what a man's age has done to it.
  const wanting = rng.next();
  let hairStyle = rng.weighted(HAIR_STYLE_WEIGHTS);
  if (subject.age >= 45 && wanting < 0.58) hairStyle = wanting < 0.2 ? 'bald' : 'receding';
  else if (subject.age >= 35 && wanting < 0.3) hairStyle = 'receding';
  // Nobody is drawn bald in his twenties: a young man's `bald` roll is a tight
  // crop instead, which is what it looks like in real life anyway.
  if (subject.age < 30 && hairStyle === 'bald') hairStyle = 'buzz';

  const greying = subject.age >= 36 ? ((subject.age - 36) / 26) * (0.35 + rng.next() * 0.65) : 0;
  const grey = Math.min(0.85, Math.max(0, greying));

  const beard = rng.weighted(BEARD_WEIGHTS);
  const eyeColour = rng.pick(EYE_COLOURS);
  const eyeShape = rng.weighted([
    { value: 'almond' as EyeShape, weight: 24 },
    { value: 'narrow' as EyeShape, weight: 14 },
    { value: 'round' as EyeShape, weight: 8 },
  ]);
  const spacing = rng.float(0.38, 0.46);
  const height = rng.float(0.45, 0.52);
  const browWeight = rng.weighted([
    { value: 'fine' as BrowWeight, weight: 8 },
    { value: 'normal' as BrowWeight, weight: 24 },
    { value: 'heavy' as BrowWeight, weight: 14 },
  ]);
  const browLift = rng.weighted([
    { value: 'low' as BrowLift, weight: 10 },
    { value: 'level' as BrowLift, weight: 24 },
    { value: 'high' as BrowLift, weight: 10 },
  ]);
  const nose = rng.weighted([
    { value: 'straight' as NoseShape, weight: 22 },
    { value: 'broad' as NoseShape, weight: 12 },
    { value: 'small' as NoseShape, weight: 10 },
    { value: 'long' as NoseShape, weight: 8 },
  ]);
  const mouth = rng.weighted([
    { value: 'straight' as MouthShape, weight: 20 },
    { value: 'smile' as MouthShape, weight: 16 },
    { value: 'full' as MouthShape, weight: 12 },
    { value: 'thin' as MouthShape, weight: 10 },
  ]);
  const glasses = rng.chance(0.14);

  return {
    choices: {
      shape: headShape,
      skin: skin.id,
      hair: hairColour.id,
      hairStyle,
      beard,
      glasses,
      eyeColour: eyeColourIdOf(eyeColour),
      eyeShape,
      nose,
      mouth,
      browWeight,
      browLift,
    },
    spacing,
    height,
    grey,
  };
}

/**
 * The features a face would have if nobody chose any.
 *
 * This is what the customiser opens on: not a set of defaults, but the face the
 * man's own name already gives him. It means the designer is a way of *changing*
 * a face rather than of building one from nothing, and it means the panel is
 * showing him himself the first time he looks at it. It is also what "put it
 * back how it was" puts it back to.
 */
export function rolledFaceChoices(subject: FaceSubject): FaceChoices {
  return rollFace(subject).choices;
}

/**
 * A face from somewhere else, for the button that offers one.
 *
 * The roll is seeded by the name, so the only way to be given a different face
 * is to be given a different name to roll: `seedText` is any words at all, and
 * the button hands it a freshly invented pair. The age comes along because hair
 * thins with it, so a shuffle for a sixty-year-old offers him the cuts a
 * sixty-year-old would have rather than the ones a boy would.
 */
export function randomFaceChoices(seedText: string, age: number): FaceChoices {
  return rollFace({ id: 'face-shuffle', firstName: seedText, surname: '', age }).choices;
}

/* ---------------------------------------------------------------- the draw order */

/**
 * A face, drawn from a man and the features he chose.
 *
 * The roll comes first and always, and the choices are laid over the top of it.
 * So the parts he picked are his, the parts he did not are the generator's, and
 * a man with no choices at all — which is everybody but the manager — is drawn
 * by exactly the numbers he was drawn by before any of this existed.
 *
 * What the choices cannot override is his age. Hair that has gone grey goes
 * grey, and it does it to the colour he chose rather than to the one he did not,
 * because a man ages and a save file does not.
 */
export function facePlan(subject: FaceSubject): FacePlan {
  const roll = rollFace(subject);
  const chosen = subject.face ?? roll.choices;
  const hair = hairColourFor(chosen.hair);

  return {
    head: HEADS[chosen.shape],
    shape: chosen.shape,
    skin: skinToneFor(chosen.skin),
    hair: {
      fill: mixColours(hair.fill, GREY, roll.grey),
      shade: mixColours(hair.shade, GREY, roll.grey),
    },
    hairStyle: chosen.hairStyle,
    beard: chosen.beard,
    eyes: {
      colour: eyeColourFor(chosen.eyeColour),
      shape: chosen.eyeShape,
      spacing: roll.spacing,
      height: roll.height,
    },
    brows: {
      weight: browWeightValue(chosen.browWeight),
      lift: browLiftValue(chosen.browLift),
    },
    nose: chosen.nose,
    mouth: chosen.mouth,
    glasses: chosen.glasses,
    grey: roll.grey,
  };
}

/* ------------------------------------------------------------ the customiser's rows */

/**
 * One thing a manager can change about his own face, and everything he can
 * change it to.
 *
 * A row is data rather than markup because the twelve of them are the same
 * shape: a name, a line saying what it is for, and the options to choose
 * between. `components/FaceDesigner.tsx` is the single renderer for all of
 * them, which is what stops twelve controls from becoming twelve idioms.
 *
 * The option values are `string | boolean` because a feature is a name and
 * glasses are a yes-or-no, and the key they belong to says which. The row knows
 * its own key, so the designer can write `{ [row.key]: value }` without a list
 * of twelve cases — one cast in one place, instead of twelve.
 */
export interface FaceChoiceOption {
  value: string | boolean;
  label: string;
  /** The paint to show beside the label, for the choices that are a colour. */
  colour?: string;
}

export interface FaceChoiceRow {
  key: keyof FaceChoices;
  label: string;
  hint: string;
  options: FaceChoiceOption[];
}

/** The words on the buttons. The domain holds the names; these are their labels. */
const HAIR_STYLE_LABELS: Record<HairStyle, string> = {
  bald: 'Bald',
  receding: 'Receding',
  buzz: 'Buzz cut',
  crop: 'Crop',
  fringe: 'Fringe',
  side: 'Side part',
  curls: 'Curls',
  afro: 'Afro',
  long: 'Long',
};

const BEARD_LABELS: Record<BeardStyle, string> = {
  none: 'Clean shaven',
  stubble: 'Stubble',
  moustache: 'Moustache',
  goatee: 'Goatee',
  beard: 'Beard',
};

const EYE_SHAPE_LABELS: Record<EyeShape, string> = {
  round: 'Round',
  almond: 'Almond',
  narrow: 'Narrow',
};

const NOSE_LABELS: Record<NoseShape, string> = {
  small: 'Small',
  straight: 'Straight',
  broad: 'Broad',
  long: 'Long',
};

const MOUTH_LABELS: Record<MouthShape, string> = {
  thin: 'Thin',
  straight: 'Straight',
  full: 'Full',
  smile: 'A smile',
};

/**
 * The twelve rows, in the order a face is built in: the silhouette first, then
 * what is on it, then the features that only read at profile size.
 */
export const FACE_CHOICE_ROWS: FaceChoiceRow[] = [
  {
    key: 'shape',
    label: 'Head shape',
    hint: 'The skull everything else is measured from.',
    options: FACE_SHAPES.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) })),
  },
  {
    key: 'skin',
    label: 'Skin tone',
    hint: 'Nine tones, palest first. Each carries its own shade, so the jaw stays a jaw.',
    options: SKIN_TONES.map((entry) => ({ value: entry.value.id, label: entry.value.label, colour: entry.value.fill })),
  },
  {
    key: 'hairStyle',
    label: 'Hair',
    hint: 'What is left of it, and where. Age has the last word on thinning.',
    options: HAIR_STYLES.map((value) => ({ value, label: HAIR_STYLE_LABELS[value] })),
  },
  {
    key: 'hair',
    label: 'Hair colour',
    hint: 'His own colour. Grey arrives with his age, on top of whatever he picked.',
    options: HAIR_COLOURS.map((entry) => ({ value: entry.value.id, label: entry.value.label, colour: entry.value.fill })),
  },
  {
    key: 'beard',
    label: 'Beard',
    hint: 'Drawn in the hair colour, so the two agree.',
    options: BEARD_STYLES.map((value) => ({ value, label: BEARD_LABELS[value] })),
  },
  {
    key: 'glasses',
    label: 'Glasses',
    hint: 'Sitting on the nose, or not there at all.',
    options: [
      { value: false, label: 'None' },
      { value: true, label: 'Glasses' },
    ],
  },
  {
    key: 'eyeColour',
    label: 'Eye colour',
    hint: 'The one feature people name when they are describing somebody.',
    options: EYE_COLOURS_BY_ID.map((entry) => ({ value: entry.id, label: entry.label, colour: entry.fill })),
  },
  {
    key: 'eyeShape',
    label: 'Eyes',
    hint: 'How open they are, which is most of what a face is doing.',
    options: EYE_SHAPES.map((value) => ({ value, label: EYE_SHAPE_LABELS[value] })),
  },
  {
    key: 'browWeight',
    label: 'Eyebrows',
    hint: 'How thick they are drawn. They never reach the hairline whatever they weigh.',
    options: BROW_WEIGHTS.map((entry) => ({ value: entry.id, label: entry.label })),
  },
  {
    key: 'browLift',
    label: 'Eyebrow height',
    hint: 'Level reads as calm; low as a scowl, high as a question.',
    options: BROW_LIFTS.map((entry) => ({ value: entry.id, label: entry.label })),
  },
  {
    key: 'nose',
    label: 'Nose',
    hint: 'Built from the head, so it fits whichever skull he picked.',
    options: NOSE_SHAPES.map((value) => ({ value, label: NOSE_LABELS[value] })),
  },
  {
    key: 'mouth',
    label: 'Mouth',
    hint: 'The line the whole face is read off.',
    options: MOUTH_SHAPES.map((value) => ({ value, label: MOUTH_LABELS[value] })),
  },
];
