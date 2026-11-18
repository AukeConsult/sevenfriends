// Copies the Stripe settings from the project root .env into functions/.env (gitignored), which Firebase loads for the emulators and for a deploy.
// Keys: PAYMENT (on|off), STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PUBLISHABLE_KEY, PAYMENT_AMOUNT, PAYMENT_CURRENCY. Only a key that is set in the root .env is copied.
// The copy sits between two marker lines; everything else in functions/.env is left as it is. Never prints a value.
// Runs before `npm run dev:emulators` and before a functions deploy (firebase.json predeploy).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = ['PAYMENT', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PUBLISHABLE_KEY', 'PAYMENT_AMOUNT', 'PAYMENT_MIN_AMOUNT', 'PAYMENT_MAX_AMOUNT', 'PAYMENT_CURRENCY'];
const BEGIN = '# --- from the root .env (scripts/sync-stripe.mjs): do not edit ---';
const END = '# --- end ---';

/** a text as a regular expression that matches exactly it */
const esc = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const source = join(root, '.env');
const values = {};
if (existsSync(source)) {
  for (const line of readFileSync(source, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && KEYS.includes(m[1])) {
      const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
      if (v) values[m[1]] = v;
    }
  }
}

const target = join(root, 'functions', '.env');
let rest = existsSync(target) ? readFileSync(target, 'utf8') : '';
rest = rest.replace(new RegExp(`${esc(BEGIN)}[\\s\\S]*?${esc(END)}\\n?`, 'g'), '').replace(/\s+$/, '');
const block = Object.keys(values).length ? `${BEGIN}\n${Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n')}\n${END}\n` : '';
const text = (rest ? rest + '\n\n' : '') + block;
if (text !== (existsSync(target) ? readFileSync(target, 'utf8') : '')) writeFileSync(target, text);
console.log(`stripe: ${Object.keys(values).length} setting(s) from .env copied to functions/.env (${KEYS.filter((k) => !(k in values)).join(', ') || 'none missing'} not set)`);
