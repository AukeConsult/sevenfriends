#!/usr/bin/env node
/**
 * Makes the list of jingles the app can play: it looks at the audio files in `frontend/public/sounds/` and writes
 * `frontend/public/sounds/sounds.json`, which the Settings page reads. So to add a jingle you only DROP A FILE
 * (mp3, wav, ogg, m4a, aac) in that folder: the name of the file becomes the name in the list ("Happy_birthday.mp3" ->
 * "Happy birthday").
 *
 * It runs by itself before every frontend start / build (npm pre-hooks), and by hand with:
 *   npm run sync:sounds
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../frontend/public/sounds");
const AUDIO = /\.(mp3|wav|ogg|m4a|aac)$/i;

fs.mkdirSync(folder, { recursive: true });
const jingles = fs
  .readdirSync(folder)
  .filter((file) => AUDIO.test(file))
  .sort((a, b) => a.localeCompare(b))
  .map((file) => ({ file, label: file.replace(AUDIO, "").replace(/[_]+/g, " ").trim() }));

const target = path.join(folder, "sounds.json");
const text = JSON.stringify({ jingles }, null, 2) + "\n";
if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== text) fs.writeFileSync(target, text);
console.log(`sounds: ${jingles.length} jingle(s) in frontend/public/sounds`);
