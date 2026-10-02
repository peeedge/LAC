/**
 * Adaptive reference grid and axis indicators.
 *
 * Grid spacing snaps to a 1 / 2 / 5 × 10ⁿ sequence so the on-screen density stays
 * roughly constant at any zoom — the same progression CAD and charting tools use.
 * Only lines inside the viewport are generated, so the vertex count is bounded by
 * screen size rather than drawing size, and regenerating on camera change is
 * cheap.
 */

import * as THREE from 'three';
import type { BoundingBox } from '../model/boundingBox';
import type { CadCamera } from './camera';

/** Approximate target spacing between minor grid lines, in CSS pixels. */
const TARGET_PIXEL_SPACING = 24;
/** Every Nth minor line is drawn as a major line. */
const MAJOR_EVERY = 5;
/** Safety ceiling on generated lines per axis. */
const MAX_LINES_PER_AXIS = 400;

export interface GridColors {
  minor: number;
  major: number;
  axisX: number;
  axisY: number;
}

export const DEFAULT_GRID_COLORS: GridColors = {
  minor: 0x24303c,
  major: 0x33424f,
  axisX: 0x8b3a3a,
  axisY: 0x3f7a42,
};

/**
 * Rounds a raw spacing up to the next 1 / 2 / 5 × 10ⁿ value.
 * Exported for unit testing.
 */
export function niceGridSpacing(rawSpacing: number): number {
  if (!Number.isFinite(rawSpacing) || rawSpacing <= 0) return 1;

  const exponent = Math.floor(Math.log10(rawSpacing));
  const magnitude = 10 ** exponent;
  const normalised = rawSpacing / magnitude;

  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Minor grid spacing in drawing units for the camera's current zoom. */
export function gridSpacingForScale(scale: number): number {
  return niceGridSpacing(TARGET_PIXEL_SPACING / scale);
}

/**
 * Grid geometry owner. Rebuilds only when the visible region or spacing actually
 * changes, so panning at a steady zoom does not thrash buffers every frame.
 */
export class CadGrid {
  readonly group = new THREE.Group();

  private readonly minor: THREE.LineSegments;
  private readonly major: THREE.LineSegments;
  private readonly axes: THREE.LineSegments;

  /** Rebased coordinate of the drawing's true origin, used to place the axes. */
  private originX = 0;
  private originY = 0;

  private lastKey = '';
  private visible = true;

  constructor(colors: GridColors = DEFAULT_GRID_COLORS) {
    this.minor = createLineSegments(colors.minor, 0.55);
    this.major = createLineSegments(colors.major, 0.9);
    // Axis colours vary per-vertex (X red, Y green), so the material uses them.
    this.axes = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }),
    );

    // Render behind drawing geometry.
    for (const [index, object] of [this.minor, this.major, this.axes].entries()) {
      object.renderOrder = -100 + index;
      object.frustumCulled = false;
      this.group.add(object);
    }

    this.group.position.z = -1;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.group.visible = visible;
  }

  /** Records where the true drawing origin sits in rebased coordinates. */
  setOrigin(originX: number, originY: number): void {
    this.originX = originX;
    this.originY = originY;
    // Force a rebuild so the axis lines move.
    this.lastKey = '';
  }

  /** Regenerates geometry if the view changed enough to matter. */
  update(camera: CadCamera, colors: GridColors = DEFAULT_GRID_COLORS): void {
    if (!this.visible) return;

    const spacing = gridSpacingForScale(camera.scale);
    const view = camera.getVisibleBounds();

    // Quantise the key to grid cells: sub-cell panning needs no rebuild because
    // the generated extent already overshoots the viewport by one cell.
    const key = [
      spacing,
      Math.floor(view.minX / spacing),
      Math.floor(view.minY / spacing),
      Math.ceil(view.maxX / spacing),
      Math.ceil(view.maxY / spacing),
    ].join(':');

    if (key === this.lastKey) return;
    this.lastKey = key;

    this.rebuild(view, spacing, colors);
  }

  private rebuild(view: BoundingBox, spacing: number, colors: GridColors): void {
    const majorSpacing = spacing * MAJOR_EVERY;

    const minorPositions: number[] = [];
    const majorPositions: number[] = [];

    // Extend one cell past the viewport so lines never pop in at the edges.
    const startX = Math.floor(view.minX / spacing) * spacing - spacing;
    const endX = Math.ceil(view.maxX / spacing) * spacing + spacing;
    const startY = Math.floor(view.minY / spacing) * spacing - spacing;
    const endY = Math.ceil(view.maxY / spacing) * spacing + spacing;

    const columns = Math.min(Math.ceil((endX - startX) / spacing), MAX_LINES_PER_AXIS);
    const rows = Math.min(Math.ceil((endY - startY) / spacing), MAX_LINES_PER_AXIS);

    // Grid lines are positioned in rebased space but spaced on the *world* grid,
    // so the origin offset is folded into the phase.
    for (let i = 0; i <= columns; i += 1) {
      const x = startX + i * spacing;
      const worldX = x + this.originX;
      // A line that coincides with an axis is skipped; the axis draws it.
      if (Math.abs(worldX) < spacing * 1e-6) continue;

      const target = isMultiple(worldX, majorSpacing) ? majorPositions : minorPositions;
      target.push(x, startY, 0, x, endY, 0);
    }

    for (let i = 0; i <= rows; i += 1) {
      const y = startY + i * spacing;
      const worldY = y + this.originY;
      if (Math.abs(worldY) < spacing * 1e-6) continue;

      const target = isMultiple(worldY, majorSpacing) ? majorPositions : minorPositions;
      target.push(startX, y, 0, endX, y, 0);
    }

    setPositions(this.minor, minorPositions);
    setPositions(this.major, majorPositions);

    // Axis lines sit at the drawing's true origin, expressed in rebased space.
    const axisX = -this.originX;
    const axisY = -this.originY;

    const axisPositions: number[] = [];
    const axisColors: number[] = [];

    const xColor = new THREE.Color(colors.axisX);
    const yColor = new THREE.Color(colors.axisY);

    // The X axis is the horizontal line at y = 0, drawn in the X-axis colour.
    if (axisY >= startY && axisY <= endY) {
      axisPositions.push(startX, axisY, 0, endX, axisY, 0);
      pushColor(axisColors, xColor, 2);
    }
    if (axisX >= startX && axisX <= endX) {
      axisPositions.push(axisX, startY, 0, axisX, endY, 0);
      pushColor(axisColors, yColor, 2);
    }

    setPositions(this.axes, axisPositions, axisColors);
  }

  dispose(): void {
    for (const object of [this.minor, this.major, this.axes]) {
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
    }
  }
}

function createLineSegments(color: number, opacity: number): THREE.LineSegments {
  return new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
}

function setPositions(object: THREE.LineSegments, positions: number[], colors?: number[]): void {
  const geometry = object.geometry;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
}

function pushColor(target: number[], color: THREE.Color, times: number): void {
  for (let i = 0; i < times; i += 1) target.push(color.r, color.g, color.b);
}

/** True when `value` is an integer multiple of `step`, within float tolerance. */
function isMultiple(value: number, step: number): boolean {
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-6;
}
