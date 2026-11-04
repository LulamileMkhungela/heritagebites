/**
 * Tiny JSON-file store. Deliberately dependency-free so the demo runs anywhere
 * with just Node. `data/runtime/` is gitignored; the seed is re-applied on boot
 * if the files are missing, so a fresh clone is immediately usable.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.HB_DATA_DIR || join(here, '..', '..', 'data', 'runtime');

mkdirSync(DATA_DIR, { recursive: true });

function pathFor(name) {
  return join(DATA_DIR, `${name}.json`);
}

/** Atomic-ish write: write to a temp file then rename over the target. */
function write(name, value) {
  const target = pathFor(name);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, target);
}

function read(name, fallback) {
  const p = pathFor(name);
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

export function has(name) {
  return existsSync(pathFor(name));
}

export const store = {
  load(name, fallback) {
    return read(name, fallback);
  },
  save(name, value) {
    write(name, value);
  },
  /** Read-modify-write with a fresh read each time to avoid stale overwrites. */
  update(name, fallback, mutate) {
    const current = read(name, fallback);
    const next = mutate(current);
    write(name, next);
    return next;
  },
};
