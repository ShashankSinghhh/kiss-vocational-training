// Mirrors every key in src/locales/en into the other locales. Existing translations are kept,
// new keys are added as "" (shown in English until translated), and stale keys are dropped.
// Usage: node scripts/sync-locales.mjs [--check] [--strict]
// (--check exits 1 if anything is out of sync; --strict also if a string is untranslated or its
// {{placeholders}} differ from English)
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'locales');
const source = 'en';
// Language folders only.
const targets = readdirSync(root).filter(
  (d) => d !== source && statSync(join(root, d)).isDirectory(),
);
const check = process.argv.includes('--check');
let drift = false;

function mirror(en, existing) {
  if (typeof en === 'string') return typeof existing === 'string' ? existing : '';
  const out = {};
  for (const [key, value] of Object.entries(en)) {
    out[key] = mirror(value, existing && typeof existing === 'object' ? existing[key] : undefined);
  }
  return out;
}

for (const file of readdirSync(join(root, source)).filter((f) => f.endsWith('.json'))) {
  const en = JSON.parse(readFileSync(join(root, source, file), 'utf8'));
  for (const lng of targets) {
    const dir = join(root, lng);
    const path = join(dir, file);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
    const next =
      JSON.stringify(mirror(en, current ? JSON.parse(current) : undefined), null, 2) + '\n';
    if (current.replace(/\r\n/g, '\n') === next) continue;
    drift = true;
    if (check) {
      console.error(`out of sync: ${lng}/${file}`);
    } else {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, next);
      console.log(`updated ${lng}/${file}`);
    }
  }
}

if (check && drift) {
  console.error('Run `pnpm --filter @vtmp/web i18n:sync` to fix.');
  process.exit(1);
}

// --strict (F16, BRQ-16.1): every string translated, with the same {{placeholders}} as English.
if (process.argv.includes('--strict')) {
  const problems = [];
  const vars = (s) =>
    [...s.matchAll(/{{\s*([\w.]+)\s*}}/g)]
      .map((m) => m[1])
      .sort()
      .join(',');
  const walk = (en, tr, path, where) => {
    if (typeof en === 'string') {
      if (typeof tr !== 'string' || tr.trim() === '') problems.push(`${where} ${path}: missing`);
      else if (vars(en) !== vars(tr)) problems.push(`${where} ${path}: placeholders differ`);
      return;
    }
    for (const [k, v] of Object.entries(en)) walk(v, tr?.[k], path ? `${path}.${k}` : k, where);
  };
  for (const file of readdirSync(join(root, source)).filter((f) => f.endsWith('.json'))) {
    const en = JSON.parse(readFileSync(join(root, source, file), 'utf8'));
    for (const lng of targets) {
      const path = join(root, lng, file);
      const tr = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
      walk(en, tr, '', `${lng}/${file}`);
    }
  }
  if (problems.length) {
    console.error(problems.slice(0, 50).join('\n'));
    console.error(`${problems.length} translation problem(s).`);
    process.exit(1);
  }
  console.log('All locales complete.');
}
