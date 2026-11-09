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

/** "SevenFriends_raw3_AcidBreaks.mp3" -> "Acid Breaks": the numbering prefix goes, underscores become spaces, a capital inside a word starts a new word */
function labelOf(file) {
  return file
    .replace(AUDIO, "")
    .replace(/^SevenFriends[ _]?raw\d+[ _]?/i, "")
    .replace(/_+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

fs.mkdirSync(folder, { recursive: true });
const jingles = fs
  .readdirSync(folder)
  .filter((file) => AUDIO.test(file))
  .sort((a, b) => a.localeCompare(b))
  .map((file) => ({ file, label: labelOf(file) }));

const target = path.join(folder, "sounds.json");
const text = JSON.stringify({ jingles }, null, 2) + "\n";
if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== text) fs.writeFileSync(target, text);
console.log(`sounds: ${jingles.length} jingle(s) in frontend/public/sounds`);
