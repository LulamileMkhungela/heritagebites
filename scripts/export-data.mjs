/**
 * Back up the runtime data store.
 *
 * Everything that matters — orders, enquiries, quests, loyalty stamps, the
 * notification outbox, push subscriptions — lives as JSON files in HB_DATA_DIR.
 * That is the right size of database for one restaurant, but it has one sharp
 * edge: a single file, one process, no point-in-time recovery. So take copies,
 * and take them somewhere that is not the server.
 *
 *   npm run backup                      # writes backups/hb-data-<timestamp>.json.gz
 *   HB_DATA_DIR=/var/lib/hb npm run backup
 *   node scripts/export-data.mjs --out /tmp/hb
 *
 * The archive is one gzipped JSON document holding every store plus a manifest,
 * so it can be read years later without this code. Restoring is deliberately
 * manual: stop the app, unzip, and copy the files back into HB_DATA_DIR. An
 * automated restore is a button that can destroy live orders when pressed by
 * mistake, and it is not worth the convenience here.
 */
import { createGzip } from 'node:zlib';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const dataDir = resolve(argValue('--data', process.env.HB_DATA_DIR ?? './data/runtime'));
const outDir = resolve(argValue('--out', './backups'));

if (!existsSync(dataDir)) {
  console.error(`No data directory at ${dataDir}`);
  console.error('Set HB_DATA_DIR to the folder the server writes to (see .env.example).');
  process.exit(1);
}

const files = readdirSync(dataDir).filter((name) => name.endsWith('.json'));
if (files.length === 0) {
  console.error(`No .json stores found in ${dataDir} — is that the right folder?`);
  process.exit(1);
}

/* A quick count per store, so the output says something useful, not just "ok". */
const manifest = {
  exportedAt: new Date().toISOString(),
  source: dataDir,
  host: process.env.HOSTNAME ?? null,
  files: [],
};
const payload = {};

for (const name of files) {
  const path = join(dataDir, name);
  const raw = statSync(path);
  let parsed = null;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`Refusing to write a backup: ${name} is not valid JSON (${error.message}).`);
    console.error('A corrupt store is worth investigating, not copying over the last good backup.');
    process.exit(1);
  }
  payload[name.replace(/\.json$/, '')] = parsed;
  const records = Array.isArray(parsed) ? parsed.length : Object.keys(parsed ?? {}).length;
  manifest.files.push({ name, bytes: raw.size, records });
}

mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(outDir, `hb-data-${stamp}.json.gz`);

/* Written to a temp path first: a half-written backup that looks complete is worse
   than none, because it is the one you would restore from. */
const temp = `${target}.part`;
writeFileSync(temp, JSON.stringify({ manifest, data: payload }, null, 2));

await pipeline(createReadStream(temp), createGzip({ level: 9 }), createWriteStream(target));
rmSync(temp, { force: true });
const size = statSync(target).size;

console.log(`Backed up ${manifest.files.length} store(s) from ${dataDir}`);
for (const file of manifest.files) {
  console.log(`  ${file.name.padEnd(28)} ${String(file.records).padStart(6)} record(s)  ${(file.bytes / 1024).toFixed(0)}kB`);
}
console.log(`\nWrote ${target} (${(size / 1024).toFixed(0)}kB gzipped)`);
console.log('Copy it off this machine. A backup that lives on the same disk as the data is not a backup.');
