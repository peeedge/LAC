import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(
  new URL('../src/cad/parsers/__fixtures__/sample.dxf', import.meta.url),
);

interface CanvasFingerprint {
  backgroundPixels: number;
  foregroundPixels: number;
  hash: number;
}

async function canvasFingerprint(canvas: Locator): Promise<CanvasFingerprint> {
  return canvas.evaluate((element) => {
    const target = element as HTMLCanvasElement;
    const gl = target.getContext('webgl2') ?? target.getContext('webgl');
    if (!gl) throw new Error('The CAD canvas does not have a WebGL context');

    const pixels = new Uint8Array(target.width * target.height * 4);
    gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // CadRenderer clears to #1b2129. Count every pixel that differs from that
    // background and keep a compact hash so visibility changes can be observed.
    let backgroundPixels = 0;
    let foregroundPixels = 0;
    let hash = 0x811c9dc5;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index] ?? 0;
      const green = pixels[index + 1] ?? 0;
      const blue = pixels[index + 2] ?? 0;
      if (red === 0x1b && green === 0x21 && blue === 0x29) backgroundPixels += 1;
      else foregroundPixels += 1;

      hash ^= red | (green << 8) | (blue << 16);
      hash = Math.imul(hash, 0x01000193);
    }

    return { backgroundPixels, foregroundPixels, hash: hash >>> 0 };
  });
}

async function loadFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.setInputFiles('[data-testid="file-input"]', normalize(FIXTURE));
  await expect(page.getByTestId('status-state')).toHaveText('Ready');
}

test('loads a DXF and toggles a layer', async ({ page }) => {
  await loadFixture(page);

  await expect(page.getByTestId('cad-viewport')).toBeVisible();
  await expect(page.getByTestId('cad-canvas')).toBeVisible();
  await expect(page.getByTestId('entity-count')).not.toHaveText('0');

  const wallsToggle = page.getByTestId('layer-toggle-WALLS');
  await expect(wallsToggle).toHaveAttribute('aria-label', 'Hide layer WALLS');
  await wallsToggle.click();
  await expect(wallsToggle).toHaveAttribute('aria-label', 'Show layer WALLS');
});

test('renders entities into the WebGL canvas', async ({ page }) => {
  await loadFixture(page);

  const canvas = page.getByTestId('cad-canvas');
  const initial = await canvasFingerprint(canvas);
  expect(initial.backgroundPixels).toBeGreaterThan(0);
  expect(initial.foregroundPixels).toBeGreaterThan(0);

  const wallsToggle = page.getByTestId('layer-toggle-WALLS');
  await wallsToggle.click();

  await expect
    .poll(async () => (await canvasFingerprint(canvas)).hash)
    .not.toBe(initial.hash);
});

test('downloads an unchanged copy of the opened drawing', async ({ page }) => {
  await loadFixture(page);

  const saveButton = page.getByTestId('toolbar-save');
  await expect(saveButton).toBeEnabled();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    saveButton.click(),
  ]);

  expect(download.suggestedFilename()).toBe('sample.dxf');
  expect(await readFile(await download.path())).toEqual(await readFile(FIXTURE));
});
