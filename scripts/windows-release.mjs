// One command for the Windows app: build it, pack the installer, and put the installer where the website serves it.
//   npm run windows:release       then:  npm run deploy:hosting
// 1. dotnet publish   -> windows/publish/SevenFriends.exe (self-contained, no .NET needed to run it)
// 2. Inno Setup (ISCC) -> windows/installer/output/SevenFriendsSetup.exe
// 3. copy             -> frontend/public/downloads/SevenFriendsSetup.exe
// Needs on this computer: the .NET SDK 8 or newer, and Inno Setup 6 (https://jrsoftware.org/isdl.php; found in its usual folders, not only on the PATH).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publishFolder = join(root, "windows", "publish");
const installer = join(root, "windows", "installer", "output", "SevenFriendsSetup.exe");
const target = join(root, "frontend", "public", "downloads", "SevenFriendsSetup.exe");

/** Runs a program and stops the whole script when it fails. */
function run(title, program, args, options = {}) {
  console.log(`\n== ${title}`);
  const done = spawnSync(program, args, { stdio: "inherit", cwd: root, ...options });
  if (done.error || done.status !== 0) {
    console.error(`\nStopped at: ${title}${done.error ? ` (${done.error.message})` : ""}`);
    process.exit(done.status || 1);
  }
}

run("1/3 Build the app", "dotnet", [
  "publish", join("windows", "SevenFriends.csproj"), "-c", "Release", "-r", "win-x64", "--self-contained", "true",
  "-p:PublishSingleFile=true", "-p:IncludeNativeLibrariesForSelfExtract=true", "-o", publishFolder,
]);

const programFiles = [process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", process.env.ProgramFiles ?? "C:\\Program Files", join(process.env.LOCALAPPDATA ?? "", "Programs")];
const iscc = programFiles.map((folder) => join(folder, "Inno Setup 6", "ISCC.exe")).find((path) => existsSync(path));
if (!iscc) {
  console.error("\nInno Setup 6 was not found. Install it from https://jrsoftware.org/isdl.php and run this again.");
  process.exit(1);
}
run("2/3 Pack the installer", iscc, [join(root, "windows", "installer", "SevenFriends.iss")]);

console.log("\n== 3/3 Copy to the website downloads");
mkdirSync(dirname(target), { recursive: true });
copyFileSync(installer, target);
console.log(`${(statSync(target).size / 1024 / 1024).toFixed(1)} MB in frontend/public/downloads/SevenFriendsSetup.exe: run npm run deploy:hosting to publish it.`);
