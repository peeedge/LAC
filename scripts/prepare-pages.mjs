/**
 * Copies the Vite production build into docs/ so GitHub Pages can serve it
 * from the main branch (Settings → Pages → Deploy from a branch → /docs).
 */
import { cp, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(projectRoot, 'dist');
const docsDir = join(projectRoot, 'docs');

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(distDir))) {
    console.error('[prepare-pages] dist/ is missing. Run `npm run build` first.');
    process.exit(1);
  }

  await rm(docsDir, { recursive: true, force: true });
  await cp(distDir, docsDir, { recursive: true });
  await writeFile(join(docsDir, '.nojekyll'), '');
  console.log('[prepare-pages] wrote docs/ for GitHub Pages (branch: main, folder: /docs).');
}

main().catch((error) => {
  console.error('[prepare-pages] failed:', error);
  process.exit(1);
});
