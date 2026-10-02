/**
 * WebGL renderer for the CAD viewport.
 *
 * Owns the Three.js scene and draws on demand rather than in a continuous
 * animation loop: a static drawing costs zero GPU time, and interaction requests
 * a frame through {@link requestRender}. Drawing geometry arrives pre-batched per
 * layer from the geometry pipeline, so loading a drawing is mostly just buffer
 * uploads and layer visibility is one flag per batch.
 *
 * This class is deliberately free of React. The viewport component creates one,
 * feeds it data, and disposes it.
 */

import * as THREE from 'three';
import { PickKind, type GeometryBundle, type TextRun } from '../geometry/buildGeometry';
import type { CadLayer } from '../model/document';
import { CadCamera } from './camera';
import { CadGrid, DEFAULT_GRID_COLORS } from './grid';
import { TextAtlas } from './textAtlas';

/** Viewport palette, tuned to read like a professional CAD workspace. */
export const VIEWPORT_BACKGROUND = 0x1b2129;
const SELECTION_COLOR = 0x4da3ff;
const HOVER_COLOR = 0x8fc6ff;

/** Pixel size for POINT entities. */
const POINT_SIZE = 5;

interface LayerObjects {
  lines?: THREE.LineSegments;
  points?: THREE.Points;
  faces?: THREE.Mesh;
  text?: THREE.Mesh;
}

export class CadRenderer {
  readonly camera = new CadCamera();

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly threeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  private readonly grid = new CadGrid();

  /** Drawing geometry, grouped so layer visibility is a single flag. */
  private readonly drawingGroup = new THREE.Group();
  private readonly layerObjects = new Map<number, LayerObjects>();

  /** Overlay geometry for selection and hover highlights. */
  private readonly selectionLines: THREE.LineSegments;
  private readonly selectionPoints: THREE.Points;
  private readonly hoverLines: THREE.LineSegments;

  private textAtlas: TextAtlas | null = null;
  private atlasTexture: THREE.CanvasTexture | null = null;

  private bundle: GeometryBundle | null = null;
  private layers: readonly CadLayer[] = [];

  private frameHandle: number | null = null;
  private disposed = false;

  /** Notified after each frame, so the UI can refresh the zoom readout. */
  onAfterRender?: () => void;

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      // Keeping the drawing buffer lets tests read pixels back after a frame.
      preserveDrawingBuffer: true,
    });
    this.renderer.setClearColor(VIEWPORT_BACKGROUND, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene.add(this.grid.group);
    this.scene.add(this.drawingGroup);

    this.selectionLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: SELECTION_COLOR }),
    );
    this.selectionPoints = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: SELECTION_COLOR, size: POINT_SIZE * 2, sizeAttenuation: false }),
    );
    this.hoverLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: HOVER_COLOR, transparent: true, opacity: 0.7 }),
    );

    for (const overlay of [this.hoverLines, this.selectionLines, this.selectionPoints]) {
      overlay.frustumCulled = false;
      // Draw above everything else so highlights are never hidden.
      overlay.renderOrder = 1000;
      overlay.position.z = 1;
      this.scene.add(overlay);
    }

    this.threeCamera.position.z = 10;
  }

  // -------------------------------------------------------------------------
  // Sizing
  // -------------------------------------------------------------------------

  /** Resizes the drawing buffer. Call on mount and whenever the element resizes. */
  setSize(width: number, height: number): void {
    const safeWidth = Math.max(Math.floor(width), 1);
    const safeHeight = Math.max(Math.floor(height), 1);

    this.camera.setViewport(safeWidth, safeHeight);
    this.renderer.setSize(safeWidth, safeHeight, false);
    this.requestRender();
  }

  // -------------------------------------------------------------------------
  // Content
  // -------------------------------------------------------------------------

  /** Replaces the rendered drawing. Previous GPU resources are released. */
  setDrawing(bundle: GeometryBundle, layers: readonly CadLayer[]): void {
    this.clearDrawing();

    this.bundle = bundle;
    this.layers = layers;

    for (const batch of bundle.lineBatches) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(expandTo3D(batch.positions), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(batch.colors, 3));

      const lines = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({ vertexColors: true }),
      );
      // Bounds are already known from the document, and per-batch frustum culling
      // would be wrong anyway because a batch spans the whole layer.
      lines.frustumCulled = false;
      this.attach(batch.layerIndex, 'lines', lines);
    }

    for (const batch of bundle.pointBatches) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(expandTo3D(batch.positions), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(batch.colors, 3));

      const points = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({ vertexColors: true, size: POINT_SIZE, sizeAttenuation: false }),
      );
      points.frustumCulled = false;
      this.attach(batch.layerIndex, 'points', points);
    }

    for (const batch of bundle.faceBatches) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(expandTo3D(batch.positions), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(batch.colors, 3));

      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      );
      mesh.frustumCulled = false;
      // Behind lines so outlines stay visible on top of fills.
      mesh.renderOrder = -10;
      this.attach(batch.layerIndex, 'faces', mesh);
    }

    this.buildText(bundle.textRuns);

    this.grid.setOrigin(bundle.origin.x, bundle.origin.y);
    this.applyLayerVisibility(layers);
    this.requestRender();
  }

  /**
   * Builds one textured quad per text run, grouped into a mesh per layer.
   *
   * Quads are generated in rebased world space with the baseline at the run's
   * origin, then alignment and rotation are applied per-vertex on the CPU. That
   * avoids a custom shader while still costing only one draw call per layer.
   */
  private buildText(runs: readonly TextRun[]): void {
    if (runs.length === 0) return;

    // The atlas needs a DOM canvas; skip text where one is unavailable.
    if (!this.textAtlas) {
      try {
        this.textAtlas = new TextAtlas();
      } catch (error) {
        console.warn('[LiteCAD] text rendering unavailable', error);
        return;
      }
    }

    const atlas = this.textAtlas;
    const byLayer = new Map<number, { positions: number[]; uvs: number[]; colors: number[] }>();
    const color = new THREE.Color();

    for (const run of runs) {
      const entry = atlas.acquire(run.value);
      if (!entry) continue;

      // Convert rasterisation pixels to drawing units via the font's cap height.
      const unitsPerPixel = run.height / atlas.capHeight;
      const widthUnits = entry.width * unitsPerPixel * (run.widthFactor || 1);
      const ascentUnits = entry.ascent * unitsPerPixel;
      const descentUnits = entry.descent * unitsPerPixel;

      // Offset from the insertion point to the text baseline origin.
      const offsetX =
        run.horizontalAlign === 'center'
          ? -widthUnits / 2
          : run.horizontalAlign === 'right'
            ? -widthUnits
            : 0;
      const offsetY =
        run.verticalAlign === 'top'
          ? -run.height
          : run.verticalAlign === 'middle'
            ? -run.height / 2
            : run.verticalAlign === 'bottom'
              ? descentUnits
              : 0;

      const cos = Math.cos(run.rotation);
      const sin = Math.sin(run.rotation);

      // Quad corners in baseline-local space, then rotated about the insertion point.
      const corners: ReadonlyArray<readonly [number, number]> = [
        [offsetX, offsetY - descentUnits],
        [offsetX + widthUnits, offsetY - descentUnits],
        [offsetX + widthUnits, offsetY + ascentUnits],
        [offsetX, offsetY + ascentUnits],
      ];

      const bucket = byLayer.get(run.layerIndex) ?? { positions: [], uvs: [], colors: [] };
      byLayer.set(run.layerIndex, bucket);

      color.set(run.color);

      const uvs: ReadonlyArray<readonly [number, number]> = [
        [entry.u0, entry.v0],
        [entry.u1, entry.v0],
        [entry.u1, entry.v1],
        [entry.u0, entry.v1],
      ];

      // Two triangles per quad.
      for (const cornerIndex of [0, 1, 2, 0, 2, 3]) {
        const [lx, ly] = corners[cornerIndex];
        bucket.positions.push(run.x + lx * cos - ly * sin, run.y + lx * sin + ly * cos, 0.2);
        bucket.uvs.push(uvs[cornerIndex][0], uvs[cornerIndex][1]);
        bucket.colors.push(color.r, color.g, color.b);
      }
    }

    if (byLayer.size === 0) return;

    if (!this.atlasTexture) {
      this.atlasTexture = new THREE.CanvasTexture(atlas.canvas);
      this.atlasTexture.minFilter = THREE.LinearFilter;
      this.atlasTexture.magFilter = THREE.LinearFilter;
      // No mipmaps: the atlas is repacked as glyphs are added.
      this.atlasTexture.generateMipmaps = false;
    }
    this.atlasTexture.needsUpdate = true;

    for (const [layerIndex, bucket] of byLayer) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uvs, 2));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(bucket.colors, 3));

      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          map: this.atlasTexture,
          vertexColors: true,
          transparent: true,
          // Glyph edges are anti-aliased, so alpha-test would produce hard edges.
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      this.attach(layerIndex, 'text', mesh);
    }
  }

  private attach(layerIndex: number, slot: keyof LayerObjects, object: THREE.Object3D): void {
    const existing = this.layerObjects.get(layerIndex) ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- keyed assignment into a union of object types
    (existing as any)[slot] = object;
    this.layerObjects.set(layerIndex, existing);
    this.drawingGroup.add(object);
  }

  /** Applies each layer's `visible` flag to its batches. */
  applyLayerVisibility(layers: readonly CadLayer[]): void {
    this.layers = layers;

    for (const [layerIndex, objects] of this.layerObjects) {
      const visible = layers[layerIndex]?.visible ?? true;
      for (const object of Object.values(objects)) {
        if (object) object.visible = visible;
      }
    }

    this.requestRender();
  }

  // -------------------------------------------------------------------------
  // Highlights
  // -------------------------------------------------------------------------

  /** Highlights the given entities using their pick geometry. */
  setSelection(entityIndices: readonly number[]): void {
    this.setHighlight(this.selectionLines, this.selectionPoints, entityIndices);
  }

  /** Highlights the entity under the cursor. */
  setHover(entityIndex: number | null): void {
    this.setHighlight(this.hoverLines, null, entityIndex == null ? [] : [entityIndex]);
  }

  private setHighlight(
    lines: THREE.LineSegments,
    points: THREE.Points | null,
    entityIndices: readonly number[],
  ): void {
    const bundle = this.bundle;
    if (!bundle) return;

    const linePositions: number[] = [];
    const pointPositions: number[] = [];

    for (const entityIndex of entityIndices) {
      const start = bundle.pick.ranges[entityIndex * 2];
      const count = bundle.pick.ranges[entityIndex * 2 + 1];
      if (count === 0) continue;

      const vertices = bundle.pick.vertices;

      // Text carries a single pick vertex, so it is outlined by its bounding box.
      if (bundle.pick.kinds[entityIndex] === PickKind.Text) {
        const base = entityIndex * 4;
        if (!Number.isNaN(bundle.pick.bounds[base])) {
          pushRectangle(
            linePositions,
            bundle.pick.bounds[base],
            bundle.pick.bounds[base + 1],
            bundle.pick.bounds[base + 2],
            bundle.pick.bounds[base + 3],
          );
        }
        continue;
      }

      if (count === 1) {
        pointPositions.push(vertices[start * 2], vertices[start * 2 + 1], 1);
        continue;
      }

      for (let i = 0; i < count - 1; i += 1) {
        const a = (start + i) * 2;
        const b = (start + i + 1) * 2;
        linePositions.push(vertices[a], vertices[a + 1], 1, vertices[b], vertices[b + 1], 1);
      }
    }

    lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    lines.geometry.computeBoundingSphere();

    if (points) {
      points.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pointPositions, 3));
      points.geometry.computeBoundingSphere();
    }

    this.requestRender();
  }

  // -------------------------------------------------------------------------
  // Grid
  // -------------------------------------------------------------------------

  setGridVisible(visible: boolean): void {
    this.grid.setVisible(visible);
    this.requestRender();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /** Schedules a frame. Multiple calls in one tick coalesce into one render. */
  requestRender(): void {
    if (this.disposed || this.frameHandle !== null) return;

    this.frameHandle = requestAnimationFrame(() => {
      this.frameHandle = null;
      this.renderFrame();
    });
  }

  /** Renders immediately, bypassing the frame scheduler. */
  renderFrame(): void {
    if (this.disposed) return;

    const { centerX, centerY, scale, width, height } = this.camera;
    const halfWidth = width / 2 / scale;
    const halfHeight = height / 2 / scale;

    this.threeCamera.left = -halfWidth;
    this.threeCamera.right = halfWidth;
    this.threeCamera.top = halfHeight;
    this.threeCamera.bottom = -halfHeight;
    this.threeCamera.position.x = centerX;
    this.threeCamera.position.y = centerY;
    this.threeCamera.updateProjectionMatrix();

    this.grid.update(this.camera, DEFAULT_GRID_COLORS);

    this.renderer.render(this.scene, this.threeCamera);
    this.onAfterRender?.();
  }

  /** Fits the loaded drawing to the viewport. */
  zoomExtents(): void {
    if (this.bundle) this.camera.fitBounds(this.bundle.viewBounds);
    this.requestRender();
  }

  /** The scale at which the drawing exactly fits, used for the zoom readout. */
  getFitScale(): number {
    if (!this.bundle) return 1;

    const probe = new CadCamera();
    probe.setViewport(this.camera.width, this.camera.height);
    probe.fitBounds(this.bundle.viewBounds);
    return probe.scale;
  }

  get hasDrawing(): boolean {
    return this.bundle !== null;
  }

  get geometry(): GeometryBundle | null {
    return this.bundle;
  }

  get currentLayers(): readonly CadLayer[] {
    return this.layers;
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  /** Releases drawing geometry while keeping the renderer alive. */
  clearDrawing(): void {
    for (const objects of this.layerObjects.values()) {
      for (const object of Object.values(objects)) {
        if (!object) continue;
        this.drawingGroup.remove(object);
        disposeObject(object);
      }
    }

    this.layerObjects.clear();
    this.bundle = null;
    this.layers = [];

    this.setHighlightEmpty();
  }

  private setHighlightEmpty(): void {
    for (const overlay of [this.selectionLines, this.selectionPoints, this.hoverLines]) {
      overlay.geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);

    this.clearDrawing();
    this.grid.dispose();

    for (const overlay of [this.selectionLines, this.selectionPoints, this.hoverLines]) {
      disposeObject(overlay);
    }

    this.atlasTexture?.dispose();
    this.renderer.dispose();
    // Release the WebGL context so repeated mounts do not exhaust the browser limit.
    this.renderer.forceContextLoss();
  }

  /** Exposed for tests and for a future PNG export. */
  get domElement(): HTMLCanvasElement {
    return this.canvas;
  }
}

/**
 * Three.js requires 3-component positions, while the geometry pipeline stores
 * compact 2D pairs. This widens them, writing z = 0.
 */
function expandTo3D(source: Float32Array): Float32Array {
  const vertexCount = source.length / 2;
  const target = new Float32Array(vertexCount * 3);

  for (let i = 0; i < vertexCount; i += 1) {
    target[i * 3] = source[i * 2];
    target[i * 3 + 1] = source[i * 2 + 1];
  }

  return target;
}

function pushRectangle(
  target: number[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  const corners: ReadonlyArray<readonly [number, number]> = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];

  for (let i = 0; i < 4; i += 1) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    target.push(ax, ay, 1, bx, by, 1);
  }
}

function disposeObject(object: THREE.Object3D): void {
  const withGeometry = object as THREE.Mesh;
  withGeometry.geometry?.dispose();

  const material = withGeometry.material;
  if (Array.isArray(material)) {
    for (const entry of material) entry.dispose();
  } else {
    material?.dispose();
  }
}
