import { describe, expect, it } from 'vitest';
import { CadCamera, FIT_PADDING, zoomPercent } from './camera';

function createCamera(width = 800, height = 600): CadCamera {
  const camera = new CadCamera();
  camera.setViewport(width, height);
  return camera;
}

describe('CadCamera', () => {
  it('round-trips screen and world coordinates', () => {
    const camera = createCamera();
    camera.centerX = 100;
    camera.centerY = 50;
    camera.scale = 2;

    const world = camera.screenToWorld(400, 300);
    // The viewport centre maps to the camera centre.
    expect(world.x).toBeCloseTo(100);
    expect(world.y).toBeCloseTo(50);

    const screen = camera.worldToScreen(world.x, world.y);
    expect(screen.x).toBeCloseTo(400);
    expect(screen.y).toBeCloseTo(300);
  });

  it('inverts the Y axis, since screen Y grows downward', () => {
    const camera = createCamera();
    camera.scale = 1;

    // 100px above the centre should be +100 drawing units.
    expect(camera.screenToWorld(400, 200).y).toBeCloseTo(100);
  });

  it('fits bounds with padding and centres on them', () => {
    const camera = createCamera(800, 600);
    camera.fitBounds({ minX: 0, minY: 0, maxX: 400, maxY: 300 });

    expect(camera.centerX).toBeCloseTo(200);
    expect(camera.centerY).toBeCloseTo(150);
    // Both axes fit at exactly 2 px/unit, reduced by the padding factor.
    expect(camera.scale).toBeCloseTo(2 * (1 - FIT_PADDING));
  });

  it('fits by the more constrained axis', () => {
    const camera = createCamera(800, 600);
    // Very wide drawing: width is the binding constraint.
    camera.fitBounds({ minX: 0, minY: 0, maxX: 8000, maxY: 100 });
    expect(camera.scale).toBeCloseTo(0.1 * (1 - FIT_PADDING));
  });

  it('fits a drawing far from the origin', () => {
    const camera = createCamera(800, 600);
    camera.fitBounds({ minX: 1_000_000, minY: 2_000_000, maxX: 1_000_400, maxY: 2_000_300 });

    expect(camera.centerX).toBeCloseTo(1_000_200);
    expect(camera.centerY).toBeCloseTo(2_000_150);
    expect(camera.scale).toBeCloseTo(2 * (1 - FIT_PADDING));
  });

  it('keeps a degenerate drawing at a finite scale', () => {
    const camera = createCamera();
    camera.fitBounds({ minX: 5, minY: 5, maxX: 5, maxY: 5 });
    expect(Number.isFinite(camera.scale)).toBe(true);
    expect(camera.scale).toBeGreaterThan(0);
  });

  it('pans in drawing units scaled by zoom', () => {
    const camera = createCamera();
    camera.scale = 4;
    camera.centerX = 0;
    camera.centerY = 0;

    camera.panByPixels(40, 20);
    // Dragging right moves the camera left; dragging down moves it up.
    expect(camera.centerX).toBeCloseTo(-10);
    expect(camera.centerY).toBeCloseTo(5);
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const camera = createCamera();
    camera.scale = 1;
    camera.centerX = 0;
    camera.centerY = 0;

    const anchorScreen = { x: 650, y: 150 };
    const before = camera.screenToWorld(anchorScreen.x, anchorScreen.y);

    camera.zoomAtScreenPoint(2.5, anchorScreen.x, anchorScreen.y);

    const after = camera.screenToWorld(anchorScreen.x, anchorScreen.y);
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
    expect(camera.scale).toBeCloseTo(2.5);
  });

  it('zooms about the viewport centre, leaving the centre unchanged', () => {
    const camera = createCamera();
    camera.centerX = 10;
    camera.centerY = -20;
    camera.scale = 1;

    camera.zoomBy(3);

    expect(camera.centerX).toBeCloseTo(10);
    expect(camera.centerY).toBeCloseTo(-20);
    expect(camera.scale).toBeCloseTo(3);
  });

  it('rejects a non-positive scale', () => {
    const camera = createCamera();
    camera.restore({ centerX: 0, centerY: 0, scale: 0 });
    expect(camera.scale).toBe(1);

    camera.restore({ centerX: 0, centerY: 0, scale: Number.NaN });
    expect(camera.scale).toBe(1);
  });

  it('converts a pixel radius into drawing units', () => {
    const camera = createCamera();
    camera.scale = 8;
    expect(camera.pixelsToWorld(16)).toBeCloseTo(2);
  });

  it('reports zoom relative to the fit scale', () => {
    expect(zoomPercent(2, 2)).toBeCloseTo(100);
    expect(zoomPercent(4, 2)).toBeCloseTo(200);
    expect(zoomPercent(1, 0)).toBe(100);
  });
});
