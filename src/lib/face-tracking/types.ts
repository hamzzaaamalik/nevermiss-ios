/** head: one emoji riding above the forehead. mask: one emoji over the
 *  whole face. crown: a small arc of emoji just above the head that
 *  follows and tilts with it (Build 44; these were "floaters" fixed to
 *  the top of the tile before). */
export type StickerKind = "head" | "mask" | "crown";

export interface Sticker {
  id: string;
  /** Single emoji glyph (rendered on canvas). */
  emoji: string;
  /** User-facing name shown in the picker tooltip. */
  label: string;
  kind: StickerKind;
  /** For "head" stickers: vertical offset above the forehead landmark,
   *  as a fraction of face height. Negative = up. Default -0.45 for hats. */
  yOffset?: number;
  /** Sticker font size as a multiple of face width. Default 1.2 for hats,
   *  1.4 for masks. */
  scale?: number;
  /** Crown only: the emoji along the arc, left to right. */
  glyphs?: string[];
  /** Crown only: size of each glyph relative to the others (default 1). */
  sizes?: number[];
}

export interface FacePose {
  /** Top-of-forehead (landmark 10) in canvas pixel coords. */
  forehead: { x: number; y: number };
  /** Nose tip (landmark 1) in canvas pixel coords. */
  nose: { x: number; y: number };
  /** Face width = euclidean distance between cheekbones (234↔454). */
  faceWidth: number;
  /** Face height = forehead → chin (10 → 152). */
  faceHeight: number;
  /** Roll angle in radians, from eye-line tilt. Right ear-down = positive. */
  roll: number;
}
