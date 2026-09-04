import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/**
 * Enforces SPEC section 12's performance budget against the **built output**.
 *
 * Two separate claims are checked, because passing one does not imply the other:
 *
 *   1. **Isolation.** Chart.js, dnd-kit and the markdown pair must not be
 *      reachable from the landing route. This walks the transitive *static*
 *      import closure recorded in Vite's manifest — the set of files a browser
 *      actually downloads before the route can render — and fails if any of them
 *      appears in it. Dynamic imports are deliberately not followed: that is
 *      precisely the boundary keeping a library out.
 *
 *   2. **Size.** Landing under 150 KB gzipped, dashboard under 300 KB.
 *
 * Checking only the size would prove nothing about isolation: a chunk can come
 * in under budget and still drag Chart.js behind it, and a coincidence is not a
 * guarantee. So the closure is also grepped for library fingerprints in the
 * emitted JavaScript, which catches a library arriving by a path the manifest
 * describes differently than expected.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, '..', 'dist');
const manifestPath = path.join(distDir, '.vite', 'manifest.json');

const KB = 1024;

/** Libraries that must never reach the landing route, by module id and by content. */
const FORBIDDEN_ON_LANDING = [
  {
    label: 'Chart.js',
    module: /node_modules\/(chart\.js|react-chartjs-2)\//,
    marker: 'Chart.js v',
  },
  { label: 'dnd-kit', module: /node_modules\/@dnd-kit\//, marker: '@dnd-kit' },
  { label: 'marked (markdown)', module: /node_modules\/marked\//, marker: 'marked' },
  { label: 'DOMPurify', module: /node_modules\/dompurify\//, marker: 'DOMPurify' },
];

const BUDGETS = [
  { label: 'landing', entryHint: 'LandingPage', limitKb: 150, enforceIsolation: true },
  { label: 'dashboard', entryHint: 'DashboardPage', limitKb: 300, enforceIsolation: false },
];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

/**
 * Every chunk a browser must have before this route paints: the HTML entry, its
 * static imports, and their imports, transitively. `dynamicImports` is skipped
 * on purpose — that is the lazy boundary.
 */
function staticClosure(manifest, startKeys) {
  const seen = new Set();
  const queue = [...startKeys];

  while (queue.length > 0) {
    const key = queue.pop();
    if (key === undefined || seen.has(key)) continue;

    const chunk = manifest[key];
    if (!chunk) continue;

    seen.add(key);
    for (const next of chunk.imports ?? []) queue.push(next);
  }

  return seen;
}

/** The manifest key of the HTML entry point. */
function entryKey(manifest) {
  const html = Object.entries(manifest).find(
    ([key, chunk]) => chunk.isEntry && key.endsWith('.html'),
  );

  return html?.[0] ?? Object.keys(manifest).find((key) => manifest[key].isEntry);
}

/** The chunk carrying a given page module. */
function routeChunkKey(manifest, hint) {
  return Object.keys(manifest).find((key) => key.includes(hint));
}

function jsFilesIn(closure, manifest) {
  return [...closure]
    .map((key) => manifest[key].file)
    .filter((file) => typeof file === 'string' && file.endsWith('.js'));
}

async function gzippedSize(files) {
  let total = 0;

  for (const file of files) {
    const contents = await readFile(path.join(distDir, file));
    total += gzipSync(contents, { level: 9 }).length;
  }

  return total;
}

async function main() {
  try {
    await stat(manifestPath);
  } catch {
    fail(`No build manifest at ${manifestPath}. Run "npm run build -w client" first.`);
    return;
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entry = entryKey(manifest);

  if (!entry) {
    fail('Could not find an entry chunk in the manifest.');
    return;
  }

  console.log('Bundle budget (SPEC section 12)\n');

  for (const budget of BUDGETS) {
    const routeKey = routeChunkKey(manifest, budget.entryHint);

    if (!routeKey) {
      fail(`Could not find a chunk for ${budget.entryHint}. Is the route still lazy-loaded?`);
      continue;
    }

    const closure = staticClosure(manifest, [entry, routeKey]);
    const jsFiles = jsFilesIn(closure, manifest);
    const bytes = await gzippedSize(jsFiles);
    const kb = bytes / KB;
    const withinBudget = kb <= budget.limitKb;

    console.log(
      `  ${withinBudget ? 'OK  ' : 'OVER'} ${budget.label.padEnd(10)} ${kb.toFixed(1)} KB gzip ` +
        `(budget ${String(budget.limitKb)} KB, ${String(jsFiles.length)} chunks)`,
    );

    if (!withinBudget) {
      fail(
        `${budget.label} route is ${kb.toFixed(1)} KB gzipped, over its ${String(budget.limitKb)} KB budget.`,
      );
    }

    if (!budget.enforceIsolation) continue;

    const moduleIds = [...closure].flatMap((key) => manifest[key].src ?? []);
    const sources = await Promise.all(
      jsFiles.map((file) => readFile(path.join(distDir, file), 'utf8')),
    );

    for (const forbidden of FORBIDDEN_ON_LANDING) {
      const viaModule = moduleIds.some((id) => forbidden.module.test(id));
      const viaContent = sources.some((source) => source.includes(forbidden.marker));

      if (viaModule || viaContent) {
        fail(
          `${forbidden.label} is reachable from the ${budget.label} route ` +
            `(${viaModule ? 'module graph' : 'chunk contents'}). It must stay behind a lazy import.`,
        );
      } else {
        console.log(`       excludes ${forbidden.label}`);
      }
    }
  }

  const emitted = await readdir(path.join(distDir, 'assets')).catch(() => []);
  console.log(`\n  ${String(emitted.length)} files emitted to dist/assets`);
  console.log(
    process.exitCode === 1 ? '\nBundle budget check failed.' : '\nBundle budget check passed.',
  );
}

await main();
