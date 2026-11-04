#!/usr/bin/env node
/**
 * Makes ios/App/App/GoogleService-Info.plist (the file the iPhone build needs for push) from the service account key in .env.
 *
 *   npm run ios:config
 *
 * Same as android-config.mjs: it reads FIREBASE_SERVICE_ACCOUNT, FIREBASE_PROJECT_ID and IOS_BUNDLE_ID from .env, finds the iOS app of
 * that bundle id in the Firebase project (it is created when it does not exist yet) and writes the config file.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accessToken, call, parseEnv } from './android-config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(root, 'ios', 'App', 'App', 'GoogleService-Info.plist');

export async function run(env, write = writeFileSync) {
  const projectId = env.FIREBASE_PROJECT_ID;
  const bundleId = env.IOS_BUNDLE_ID;
  if (!projectId || !bundleId) throw new Error('Set FIREBASE_PROJECT_ID and IOS_BUNDLE_ID in .env');
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

  const { apps = [] } = await call(token, `${project}/iosApps?pageSize=100`);
  let app = apps.find((a) => a.bundleId === bundleId);
  if (app) {
    console.log(`Found the iOS app ${bundleId} (${app.appId}).`);
  } else {
    console.log(`No iOS app ${bundleId} in ${projectId} yet: creating it...`);
    let operation = await call(token, `${project}/iosApps`, { method: 'POST', body: JSON.stringify({ bundleId, displayName: 'Seven Friends' }) });
    for (let i = 0; i < 30 && !operation.done; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      operation = await call(token, `/v1/${operation.name}`);
    }
    if (!operation.done || operation.error || !operation.response) throw new Error(`Could not create the iOS app: ${operation.error?.message ?? 'it took too long'}`);
    app = operation.response;
  }

  const config = await call(token, `${project}/iosApps/${app.appId}/config`);
  const text = Buffer.from(config.configFileContents, 'base64').toString('utf8');
  if (!text.includes('<plist')) throw new Error('Firebase did not return a plist file');
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
