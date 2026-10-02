/**
 * Copies the LibreDWG WebAssembly binary into `public/wasm/` so the browser can
 * fetch it at a stable URL.
 *
 * The `@mlightcad/libredwg-web` bundle imports its Emscripten glue code through a
 * normal ESM import (so Vite bundles it), but the glue resolves the companion
 * `.wasm` file at runtime via `locateFile`. That lookup is a plain network fetch,
 * so the binary has to exist as a served static asset rather than a bundled module.
 *
 * Run automatically by the `predev` / `prebuild` npm hooks.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(projectRoot, 'node_modules', '@mlightcad', 'libredwg-web', 'wasm');
const targetDir = join(projectRoot, 'public', 'wasm');

// Only the binary is needed at runtime; the JS glue is bundled by Vite.
const assets = ['libredwg-web.wasm'];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(sourceDir))) {
    console.warn(
      '[sync-wasm] @mlightcad/libredwg-web is not installed; skipping.\n' +
        '            DWG support will be unavailable until you run `npm install`.',
    );
    return;
  }

  await mkdir(targetDir, { recursive: true });

  for (const asset of assets) {
    const from = join(sourceDir, asset);
    const to = join(targetDir, asset);

    if (!(await exists(from))) {
      console.warn(`[sync-wasm] missing source asset: ${asset}`);
      continue;
    }

    // Skip the ~9.5 MB copy when the destination is already up to date.
    const src = await stat(from);
    const dest = (await exists(to)) ? await stat(to) : null;
    if (dest && dest.size === src.size && dest.mtimeMs >= src.mtimeMs) {
      console.log(`[sync-wasm] up to date: ${asset}`);
      continue;
    }

    await copyFile(from, to);
    console.log(`[sync-wasm] copied ${asset} (${(src.size / 1024 / 1024).toFixed(1)} MB)`);
  }
}

main().catch((error) => {
  console.error('[sync-wasm] failed:', error);
  process.exit(1);
});
