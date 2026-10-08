/**
 * What a face is made of, as the things a man can choose about his own.
 *
 * The drawing lives in `src/ui/face.ts` and deliberately stays there: a head is
 * geometry and a colour is paint, and neither belongs in a save file. What does
 * belong in a save file is the *decision* — the shape of the skull, the tone of
 * the skin, the cut of the hair — because that is the part the manager made
 * rather than the part the generator rolled.
 *
 * So the vocabulary is here, where the person record and the manager's profile
 * can both hold it, and the drawing reads it. Every one of these is a specific,
 * nameable thing rather than an index: a career holds `'afro'`, not `7`, so the
 * drawing's palette can be reordered, re-weighted or extended without changing
 * a face that has already been drawn, and a save read by a later build still
 * means what it said.
 *
 * The labels are the drawing's business and not the domain's, for the same
 * reason: `'afro'` is a fact about a man, and "Afro" is a word on a button.
 */

/* ------------------------------------------------------------------ the skull */

/** The shape of the skull, which is what the hair and the ears have to fit. */
export type FaceShape = 'oval' | 'long' | 'round' | 'square' | 'heart' | 'broad';

/* ------------------------------------------------------------------- the skin */

/**
 * Skin, from the palest to the deepest.
 *
 * Nine tones and no default, named rather than numbered: a manager picking his
 * own face is picking a colour, and the name is what the button says.
 */
export type SkinToneId = 'porcelain' | 'fair' | 'light' | 'warm' | 'olive' | 'tan' | 'bronze' | 'brown' | 'deep';

/* ------------------------------------------------------------------- the hair */

/** The colour a man's hair was before his age started working on it. */
export type HairColourId = 'black' | 'dark-brown' | 'brown' | 'chestnut' | 'auburn' | 'sandy' | 'fair' | 'ginger';

/** The cut: the ones who still have it, the ones losing it, and the ones who never had it. */
export type HairStyle = 'bald' | 'receding' | 'buzz' | 'crop' | 'fringe' | 'side' | 'curls' | 'afro' | 'long';

export type BeardStyle = 'none' | 'stubble' | 'moustache' | 'goatee' | 'beard';

/* --------------------------------------------------------------- the features */

export type EyeColourId = 'dark-brown' | 'brown' | 'hazel' | 'green' | 'blue' | 'grey';

/** How open the eye is, which is most of what a face is doing. */
export type EyeShape = 'round' | 'almond' | 'narrow';

export type NoseShape = 'small' | 'straight' | 'broad' | 'long';

export type MouthShape = 'thin' | 'straight' | 'full' | 'smile';

/** How thick the brows are drawn, and how high they sit above the eyes. */
export type BrowWeight = 'fine' | 'normal' | 'heavy';
export type BrowLift = 'low' | 'level' | 'high';

/**
 * A face, as the features its owner chose.
 *
 * This is an *override*, not the whole drawing. What it replaces is only what it
 * names; the rest of the face — the distance between his eyes, the set of his
 * jaw, the way the light falls on it — still comes from the same seeded roll
 * every other man in the game gets, so two managers who pick the same features
 * are still two different men, and one who picks nothing keeps the face his name
 * already gave him.
 *
 * What it does not hold is anything derived from his age: he greys and his hair
 * thins whatever he chose, because a man ages and a save file does not.
 */
export interface FaceChoices {
  shape: FaceShape;
  skin: SkinToneId;
  hair: HairColourId;
  hairStyle: HairStyle;
  beard: BeardStyle;
  glasses: boolean;
  eyeColour: EyeColourId;
  eyeShape: EyeShape;
  nose: NoseShape;
  mouth: MouthShape;
  browWeight: BrowWeight;
  browLift: BrowLift;
}
