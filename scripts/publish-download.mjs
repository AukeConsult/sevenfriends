// Puts a finished app file where the website serves it: frontend/public/downloads/<name>, so `npm run deploy:hosting` publishes it
// and the Install page offers it (it only shows a download button for a file that is there).
// Usage: node scripts/publish-download.mjs <file made by the build> <name on the website>
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [from, name] = process.argv.slice(2);
if (!from || !name) {
  console.error("Usage: node scripts/publish-download.mjs <file> <name on the website>");
  process.exit(1);
}
const source = resolve(root, from);
if (!existsSync(source)) {
  console.error(`Not found: ${source}\nBuild it first (see windows/README.md or android/README.md).`);
  process.exit(1);
}
const target = resolve(root, "frontend/public/downloads", name);
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`${name} (${(statSync(source).size / 1024 / 1024).toFixed(1)} MB) is in frontend/public/downloads: run npm run deploy:hosting to publish it.`);
