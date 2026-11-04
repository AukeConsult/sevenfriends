#!/usr/bin/env node
/**
 * Makes android/app/google-services.json (the file the Android build needs for push) from the service account key in .env.
 *
 *   npm run android:config
 *
 * It reads FIREBASE_SERVICE_ACCOUNT (the whole key json), FIREBASE_PROJECT_ID and ANDROID_PACKAGE from .env, signs in to Google with
 * the key, finds the Android app of that package in the Firebase project (it is created when it does not exist yet), optionally adds the
 * SHA-1 fingerprint(s) in ANDROID_SHA1, and writes the config file. No packages are needed (Node 18+).
 */
import { createSign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(root, 'android', 'app', 'google-services.json');
const API = 'https://firebase.googleapis.com';

/** KEY=value lines; a value may be in single or double quotes. */
export function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trimStart().startsWith('#')) continue;
    let value = match[2];
    if (value.length >= 2 && ((value[0] === "'" && value.at(-1) === "'") || (value[0] === '"' && value.at(-1) === '"'))) value = value.slice(1, -1);
    env[match[1]] = value;
  }
  return env;
}

const base64url = (input) => Buffer.from(input).toString('base64url');

/** An access token for the service account (a signed request to Google's token address). */
export async function accessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: key.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claim))}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`Google refused the service account key (${res.status}): ${body.error_description ?? body.error ?? 'unknown'}`);
  return body.access_token;
}

export async function call(token, path, options = {}) {
  const res = await fetch(`${API}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${options.method ?? 'GET'} ${path} failed (${res.status}): ${body.error?.message ?? 'unknown'}`);
  return body;
}

export async function run(env, write = writeFileSync) {
  const projectId = env.FIREBASE_PROJECT_ID;
  const packageName = env.ANDROID_PACKAGE;
  if (!projectId || !packageName) throw new Error('Set FIREBASE_PROJECT_ID and ANDROID_PACKAGE in .env');
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('Paste the service account key (the whole json, on one line) into FIREBASE_SERVICE_ACCOUNT in .env');
  let key;
  try {
    key = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid json: paste the whole key file on ONE line, between single quotes');
  }
  if (!key.client_email || !key.private_key) throw new Error('That json is not a service account key (client_email / private_key missing)');
  if (key.project_id && key.project_id !== projectId) throw new Error(`The key belongs to project ${key.project_id}, but FIREBASE_PROJECT_ID is ${projectId}`);

  const token = await accessToken(key);
  const project = `/v1beta1/projects/${encodeURIComponent(projectId)}`;

  const { apps = [] } = await call(token, `${project}/androidApps?pageSize=100`);
  let app = apps.find((a) => a.packageName === packageName);
  if (app) {
    console.log(`Found the Android app ${packageName} (${app.appId}).`);
  } else {
    console.log(`No Android app ${packageName} in ${projectId} yet: creating it...`);
    let operation = await call(token, `${project}/androidApps`, { method: 'POST', body: JSON.stringify({ packageName, displayName: 'Seven Friends' }) });
    for (let i = 0; i < 30 && !operation.done; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      operation = await call(token, `/v1/${operation.name}`);
    }
    if (!operation.done || operation.error || !operation.response) throw new Error(`Could not create the Android app: ${operation.error?.message ?? 'it took too long'}`);
    app = operation.response;
  }

  for (const sha of (env.ANDROID_SHA1 ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    try {
      await call(token, `${project}/androidApps/${app.appId}/sha`, { method: 'POST', body: JSON.stringify({ shaHash: sha.replaceAll(':', '').toLowerCase(), certType: 'SHA_1' }) });
      console.log(`Added the SHA-1 ${sha}.`);
    } catch (err) {
      if (!/already exists|ALREADY_EXISTS/i.test(err.message)) throw err; // adding the same one again is fine
    }
  }

  const config = await call(token, `${project}/androidApps/${app.appId}/config`);
  const text = Buffer.from(config.configFileContents, 'base64').toString('utf8');
  JSON.parse(text); // it must be a json file
  mkdirSync(dirname(OUTPUT), { recursive: true });
  write(OUTPUT, text);
  console.log(`Wrote ${OUTPUT}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = join(root, '.env');
  if (!existsSync(file)) {
    console.error('There is no .env file. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  run({ ...parseEnv(readFileSync(file, 'utf8')) }).catch((err) => {
    console.error(`\n${err.message}`);
    process.exit(1);
  });
}
