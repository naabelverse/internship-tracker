import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

/**
 * Deletes the source maps from a built client and removes the comments that
 * point at them.
 *
 * `vite.config.ts` emits maps on purpose — an error tracker cannot symbolicate a
 * minified stack without them, and the Sentry upload in DEPLOYMENT.md needs real
 * files to upload. But `client/dist` is exactly what a static host publishes, so
 * shipping it unchanged puts the whole readable source, original file names and
 * all, one predictable `.js.map` fetch away from any visitor. SPEC section 17
 * asks for maps that are not publicly exposed, which means generating them,
 * handing them to the error tracker, and then not deploying them.
 *
 * Run after `vite build` and after any Sentry upload — `npm run build:deploy`
 * is that sequence.
 */
async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

// Matches the trailing `//# sourceMappingURL=...` in JavaScript and the `/*# ... */`
// form CSS uses, both only at the end of a line.
const SOURCE_MAPPING_COMMENT = /^[ \t]*(?:\/\/|\/\*)#\s*sourceMappingURL=.*$\n?/gm;

const removed = [];
let rewritten = 0;

for await (const file of walk(DIST)) {
  if (file.endsWith('.map')) {
    await rm(file);
    removed.push(path.relative(DIST, file));
    continue;
  }

  if (!/\.(js|css)$/.test(file)) continue;

  const source = await readFile(file, 'utf8');
  if (!SOURCE_MAPPING_COMMENT.test(source)) continue;

  SOURCE_MAPPING_COMMENT.lastIndex = 0;
  await writeFile(file, source.replace(SOURCE_MAPPING_COMMENT, ''));
  rewritten += 1;
}

process.stdout.write(
  `Stripped ${String(removed.length)} source maps and ${String(rewritten)} sourceMappingURL comments from client/dist\n`,
);
