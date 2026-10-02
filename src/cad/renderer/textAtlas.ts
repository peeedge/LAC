/**
 * Glyph-run atlas for CAD text.
 *
 * Each distinct string is rasterised once into a shared canvas texture, then
 * drawn as a textured quad in world space. This keeps text to a single draw call
 * per layer and scales correctly with zoom (CAD text has a real-world height),
 * without creating a DOM element per label.
 *
 * Strings are cached by value, which pays off heavily on real drawings where
 * room names, dimensions and callouts repeat.
 */

/** Rasterisation size. Large enough to stay sharp when zoomed in a few steps. */
const FONT_PIXELS = 48;
const ATLAS_SIZE = 2048;
/** Gap between entries so neighbouring glyphs never bleed under linear filtering. */
const PADDING = 2;
/** Strings longer than this are truncated; they would not be legible anyway. */
const MAX_CHARACTERS = 160;

export interface AtlasEntry {
  /** Texture coordinates, already normalised to 0..1. */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Advance width in rasterisation pixels. */
  width: number;
  /** Height above the baseline, in rasterisation pixels. */
  ascent: number;
  /** Depth below the baseline, in rasterisation pixels. */
  descent: number;
}

/**
 * Packs strings into a canvas using a shelf (row) algorithm: fill a row left to
 * right, then start a new row below. Simple, allocation-free, and well suited to
 * entries of near-identical height.
 */
export class TextAtlas {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly entries = new Map<string, AtlasEntry | null>();

  private cursorX = PADDING;
  private cursorY = PADDING;
  private rowHeight = 0;

  /** Cap height of the rasterisation font, used to convert to drawing units. */
  readonly capHeight: number;

  /** Set once the atlas runs out of room. */
  private full = false;
  /** Incremented whenever new glyphs are added, so the texture can be re-uploaded. */
  revision = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_SIZE;
    this.canvas.height = ATLAS_SIZE;

    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('2D canvas context unavailable for the text atlas.');
    this.context = context;

    this.context.font = `${FONT_PIXELS}px ui-sans-serif, system-ui, sans-serif`;
    this.context.textBaseline = 'alphabetic';
    this.context.textAlign = 'left';
    // Glyphs are rasterised white so vertex colours can tint them.
    this.context.fillStyle = '#ffffff';

    const metrics = this.context.measureText('H');
    this.capHeight = metrics.actualBoundingBoxAscent || FONT_PIXELS * 0.7;
  }

  get isFull(): boolean {
    return this.full;
  }

  /**
   * Returns the atlas entry for `value`, rasterising it on first use.
   * Returns `null` when the atlas is full or the string is blank.
   */
  acquire(value: string): AtlasEntry | null {
    const text = value.length > MAX_CHARACTERS ? `${value.slice(0, MAX_CHARACTERS - 1)}…` : value;

    const cached = this.entries.get(text);
    if (cached !== undefined) return cached;

    if (this.full || text.length === 0) {
      this.entries.set(text, null);
      return null;
    }

    const metrics = this.context.measureText(text);
    const ascent = Math.ceil(metrics.actualBoundingBoxAscent || FONT_PIXELS * 0.8);
    const descent = Math.ceil(metrics.actualBoundingBoxDescent || FONT_PIXELS * 0.2);
    const width = Math.ceil(metrics.width);
    const height = ascent + descent;

    // A single string wider than the atlas can never be packed.
    if (width + PADDING * 2 > ATLAS_SIZE) {
      this.entries.set(text, null);
      return null;
    }

    // Wrap to the next shelf when the current row is exhausted.
    if (this.cursorX + width + PADDING > ATLAS_SIZE) {
      this.cursorX = PADDING;
      this.cursorY += this.rowHeight + PADDING;
      this.rowHeight = 0;
    }

    if (this.cursorY + height + PADDING > ATLAS_SIZE) {
      this.full = true;
      this.entries.set(text, null);
      return null;
    }

    const x = this.cursorX;
    const y = this.cursorY;

    // `y + ascent` places the baseline so the glyph box starts at `y`.
    this.context.fillText(text, x, y + ascent);

    this.cursorX += width + PADDING;
    this.rowHeight = Math.max(this.rowHeight, height);
    this.revision += 1;

    const entry: AtlasEntry = {
      u0: x / ATLAS_SIZE,
      // Canvas Y grows downwards, WebGL V grows upwards, so V is flipped.
      v0: 1 - (y + height) / ATLAS_SIZE,
      u1: (x + width) / ATLAS_SIZE,
      v1: 1 - y / ATLAS_SIZE,
      width,
      ascent,
      descent,
    };

    this.entries.set(text, entry);
    return entry;
  }
}
