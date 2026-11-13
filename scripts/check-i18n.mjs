// Checks the translations: (1) every key used in the frontend code exists in the English files, (2) every other language has the same
// files and keys as English, (3) lists English keys nobody uses (with --unused). Run: npm run check:i18n
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../frontend/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const i18n = join(root, 'public/i18n');
const flat = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const load = (lang) => {
  const dir = join(i18n, lang); const out = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const scope = f.slice(0, -5); const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    out[scope] = new Set(scope === 'common' ? flat(data) : flat(data).map((k) => `${scope}.${k}`));
  }
  return out;
};
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

const en = load('en'); const enKeys = new Set(Object.values(en).flatMap((s) => [...s]));
let problems = 0;
const used = new Map();
for (const file of walk(join(root, 'src/app')).filter((f) => /\.(ts|html)$/.test(f) && !f.endsWith('.spec.ts'))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\b(?:tx?|tr)\(\s*'([A-Za-z][\w.-]*\.[\w.-]+)'(?!\s*\+)/g)) { if (!used.has(m[1])) used.set(m[1], relative(root, file)); }
}
for (const [key, file] of used) if (!enKeys.has(key) && !/^(titles\.|circle\.|errors\.)/.test(key)) { console.log(`missing in en: ${key}  (${file})`); problems++; }

for (const lang of readdirSync(i18n).filter((l) => l !== 'en' && statSync(join(i18n, l)).isDirectory())) {
  const other = load(lang);
  for (const [scope, keys] of Object.entries(en)) {
    if (!other[scope]) { console.log(`${lang}: file ${scope}.json is missing`); problems++; continue; }
    for (const k of keys) if (!other[scope].has(k)) { console.log(`${lang}: ${k} is missing`); problems++; }
    for (const k of other[scope]) if (!keys.has(k)) { console.log(`${lang}: ${k} is not in English any more`); problems++; }
  }
}
if (process.argv.includes('--unused')) {
  const code = walk(join(root, 'src/app')).filter((f) => /\.(ts|html)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const k of enKeys) if (!used.has(k) && !code.includes(`'${k}`) && !/^(circle\.|errors\.|titles\.)/.test(k)) console.log(`unused: ${k}`);
}
console.log(problems ? `\n${problems} problem(s)` : 'Translations are in order.');
process.exit(problems ? 1 : 0);
