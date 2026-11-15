#!/usr/bin/env node
/**
 * Makes the jingles of the iPhone app: ios/App/App/<key>.caf from android/app/src/main/res/raw/<key>.mp3 (the same key as the Android channel).
 * iPhone plays a push sound only from a file in the app (aiff, wav or caf, at most 30 seconds), so this needs macOS (`afconvert`).
 * Run it once after a jingle is added or changed, commit the .caf files, and add a new one to the App target in Xcode.
 *
 *   npm run ios:sounds
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = join(root, 'android', 'app', 'src', 'main', 'res', 'raw');
const out = join(root, 'ios', 'App', 'App');
if (process.platform !== 'darwin') throw new Error('afconvert only exists on macOS: run this on the Mac');

for (const file of readdirSync(raw).filter((f) => f.endsWith('.mp3'))) {
  const key = file.slice(0, -4);
  const target = join(out, `${key}.caf`);
  execFileSync('afconvert', ['-f', 'caff', '-d', 'ima4', join(raw, file), target]);
  const info = execFileSync('afinfo', [target], { encoding: 'utf8' });
  const seconds = Number(/estimated duration: ([\d.]+)/.exec(info)?.[1] ?? 0);
  console.log(`${key}.caf  ${seconds.toFixed(1)} s`);
  if (seconds > 30) console.warn(`  !! longer than 30 s: iPhone plays its default sound instead; shorten ${file}`);
}
