/**
 * Strongly typed geometry payloads for every supported CAD entity.
 *
 * These types are deliberately independent of any file format and of the
 * renderer. A parser's job is to produce these shapes; the geometry pipeline's
 * job is to turn them into GPU buffers. Angles are stored in **radians** and
 * normalised to a counter-clockwise sweep, which is the convention used
 * throughout the tessellator.
 */

export interface Point2D {
  x: number;
  y: number;
}

/** Elevation is preserved so a future 3D mode can use it, but 2D rendering ignores Z. */
export interface Point3D extends Point2D {
  z: number;
}

export interface LineGeometry {
  start: Point2D;
  end: Point2D;
}

export interface CircleGeometry {
  center: Point2D;
  radius: number;
}

export interface ArcGeometry {
  center: Point2D;
  radius: number;
  /** Radians, counter-clockwise from the positive X axis. */
  startAngle: number;
  endAngle: number;
}

export interface EllipseGeometry {
  center: Point2D;
  /** Major axis endpoint relative to `center`; its length is the major radius. */
  majorAxis: Point2D;
  /** Minor radius divided by major radius, in (0, 1]. */
  axisRatio: number;
  /** Parametric start/end angle in radians (0 .. 2π for a full ellipse). */
  startAngle: number;
  endAngle: number;
}

/**
 * A polyline vertex. `bulge` encodes a circular arc between this vertex and the
 * next one, using the DXF definition: the tangent of one quarter of the arc's
 * included angle, signed positive for counter-clockwise.
 */
export interface PolylineVertex extends Point2D {
  bulge?: number;
}

export interface PolylineGeometry {
  vertices: PolylineVertex[];
  closed: boolean;
}

export interface SplineGeometry {
  controlPoints: Point2D[];
  /** Knot vector; may be empty, in which case a uniform clamped vector is synthesised. */
  knots: number[];
  /** Per-control-point weights for a rational (NURBS) curve. */
  weights?: number[];
  degree: number;
  closed: boolean;
  /** Interpolation points, used as a fallback when control points are absent. */
  fitPoints?: Point2D[];
}

export interface PointGeometry {
  position: Point2D;
}

export type TextHorizontalAlign = 'left' | 'center' | 'right';
export type TextVerticalAlign = 'baseline' | 'bottom' | 'middle' | 'top';

export interface TextGeometry {
  /** Insertion / alignment point in world coordinates. */
  position: Point2D;
  value: string;
  /** Cap height in drawing units. */
  height: number;
  /** Baseline rotation in radians. */
  rotation: number;
  /** Horizontal stretch factor applied to glyph advance. */
  widthFactor: number;
  horizontalAlign: TextHorizontalAlign;
  verticalAlign: TextVerticalAlign;
}

/** A block reference. Rendered by expanding the referenced block's entities. */
export interface InsertGeometry {
  position: Point2D;
  blockName: string;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

/** A filled or outlined triangle/quad (SOLID, 3DFACE). */
export interface FaceGeometry {
  points: Point2D[];
}

export type CadGeometry =
  | LineGeometry
  | CircleGeometry
  | ArcGeometry
  | EllipseGeometry
  | PolylineGeometry
  | SplineGeometry
  | PointGeometry
  | TextGeometry
  | InsertGeometry
  | FaceGeometry;
