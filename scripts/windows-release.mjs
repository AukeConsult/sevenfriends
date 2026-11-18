// One command for the Windows app: build it, pack the installer, put the installer where the website serves it, and publish the website (hosting).
//   npm run windows:release                    builds, packs, copies and deploys the hosting
//   npm run windows:release -- --no-deploy     the same without the last step (deploy later with: npm run deploy:hosting)
//   npm run windows:release -- --no-msix       the same without the MSIX package (see scripts/windows-msix.mjs)
// 1. dotnet publish   -> client-wrappers/windows/publish/SevenFriends.exe (self-contained, no .NET needed to run it)
// 2. Inno Setup (ISCC) -> client-wrappers/windows/installer/output/SevenFriendsSetup.exe
// 3. copy             -> frontend/public/downloads/SevenFriendsSetup.exe
// 3b. MSIX package    -> client-wrappers/windows/msix/output/SevenFriends.msix (not put on the website; a problem here only warns)
// 4. npm run deploy:hosting -> the website, with the new installer on the Install page (the installer is git-ignored: this has to run on THIS computer)
// Needs on this computer: the .NET SDK 8 or newer, and Inno Setup 6 (https://jrsoftware.org/isdl.php; found in its usual folders, not only on the PATH).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildMsix } from "./windows-msix.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publishFolder = join(root, "client-wrappers", "windows", "publish");
const installer = join(root, "client-wrappers", "windows", "installer", "output", "SevenFriendsSetup.exe");
const target = join(root, "frontend", "public", "downloads", "SevenFriendsSetup.exe");
const deploy = !process.argv.includes("--no-deploy");
const msix = !process.argv.includes("--no-msix");

/** Runs a program and stops the whole script when it fails. */
function run(title, program, args, options = {}) {
  console.log(`\n== ${title}`);
  const done = spawnSync(program, args, { stdio: "inherit", cwd: root, ...options });
  if (done.error || done.status !== 0) {
    console.error(`\nStopped at: ${title}${done.error ? ` (${done.error.message})` : ""}`);
    process.exit(done.status || 1);
  }
}

run("1/4 Build the app", "dotnet", [
  "publish", join("client-wrappers", "windows", "SevenFriends.csproj"), "-c", "Release", "-r", "win-x64", "--self-contained", "true",
  "-p:PublishSingleFile=true", "-p:IncludeNativeLibrariesForSelfExtract=true", "-o", publishFolder,
]);

const programFiles = [process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", process.env.ProgramFiles ?? "C:\\Program Files", join(process.env.LOCALAPPDATA ?? "", "Programs")];
const iscc = programFiles.map((folder) => join(folder, "Inno Setup 6", "ISCC.exe")).find((path) => existsSync(path));
if (!iscc) {
  console.error("\nInno Setup 6 was not found. Install it from https://jrsoftware.org/isdl.php and run this again.");
  process.exit(1);
}
run("2/4 Pack the installer", iscc, [join(root, "client-wrappers", "windows", "installer", "SevenFriends.iss")]);

/**
 * Copies a file, and tries again for a while when Windows says it is busy (EBUSY / EPERM / EACCES): the virus scanner opens a freshly made .exe, and a dev server
 * (`ng serve`), the installer itself or an Explorer preview can hold the file for a moment. Gives up after about a minute, with what to close.
 */
function copyWithRetry(from, to, tries = 30) {
  for (let attempt = 1; ; attempt++) {
    try {
      copyFileSync(from, to);
      return;
    } catch (error) {
      const busy = ["EBUSY", "EPERM", "EACCES"].includes(error.code);
      if (!busy || attempt >= tries) {
        if (busy) console.error("\nThe file stays locked. Close what may hold it (SevenFriendsSetup.exe if it is open or running, the dev server, an Explorer window showing the folder), wait for the virus scanner, and run again.");
        throw error;
      }
      if (attempt === 1) console.log("The file is busy (the virus scanner or a program holds it): trying again for a minute...");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000); // wait two seconds
    }
  }
}

console.log("\n== 3/4 Copy to the website downloads");
mkdirSync(dirname(target), { recursive: true });
copyWithRetry(installer, target);
console.log(`${(statSync(target).size / 1024 / 1024).toFixed(1)} MB in frontend/public/downloads/SevenFriendsSetup.exe`);

if (msix) {
  // the installer is the download of the website: a problem with the MSIX package must not stop the release
  try {
    buildMsix({ publish: false });
  } catch (error) {
    console.warn(`\nMSIX package skipped: ${error.message}`);
  }
} else {
  console.log("\n== 3b MSIX package: not made (--no-msix)");
}

if (deploy) {
  // `shell: true`: npm is a .cmd file on Windows, which Node only starts through the shell
  run("4/4 Deploy the website (hosting)", "npm", ["run", "deploy:hosting"], { shell: true });
  console.log("\nThe new installer is on the website: open the Install page and check that Download for Windows gives the new file.");
} else {
  console.log("\n4/4 Not deployed (--no-deploy): run npm run deploy:hosting to publish it.");
}
