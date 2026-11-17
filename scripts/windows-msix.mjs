// Packs the Windows app as an MSIX package (client-wrappers/windows/msix/output/SevenFriends.msix).
//   npm run windows:msix                    publishes the app, packs it and signs it
//   npm run windows:msix -- --unsigned      packs without signing (a package that cannot be installed, only for checks)
//   npm run windows:msix -- --skip-publish  packs what is already in client-wrappers/windows/publish
// npm run windows:release does this step too (after the installer); `windows:release -- --no-msix` leaves it out.
//
// Needs the Windows 10/11 SDK (makeappx.exe and signtool.exe; found in "Windows Kits\10\bin\<version>\x64").
// Signing: Windows only installs a signed MSIX.
//   - with SF_MSIX_PFX (path to a .pfx) and SF_MSIX_PFX_PASSWORD in .env or the environment: that certificate signs it, and
//     SF_MSIX_PUBLISHER must be its Subject (for example "CN=Blueboot R&D AS"). Use this for a real certificate.
//   - without them: a self-signed TEST certificate "Seven Friends MSIX test" is made in your own certificate store (Current User) and
//     reused; its public part is written to client-wrappers/windows/msix/output/SevenFriends-test.cer. To install the package on a computer,
//     that .cer has to be trusted there first (Local Machine > Trusted People). Never ship it: the Microsoft Store signs the package for you.
// The Publisher in the manifest and the Subject of the certificate must be identical. The version is the one in SevenFriends.csproj (as x.y.z.0).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const windows = join(root, "client-wrappers", "windows");
const publishFolder = join(windows, "publish");
const msix = join(windows, "msix");
const layout = join(msix, "layout");
const outputFolder = join(msix, "output");
const outputFile = join(outputFolder, "SevenFriends.msix");
const testCertificate = join(outputFolder, "SevenFriends-test.cer");
const TEST_SUBJECT_NAME = "Seven Friends MSIX test";

/** The values of .env (only the SF_MSIX_ ones), so a certificate can be set up there next to the other secrets. */
function envFromFile() {
  const file = join(root, ".env");
  const values = {};
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(SF_MSIX_[A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) values[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return values;
}

function run(title, program, args, options = {}) {
  console.log(`\n== ${title}`);
  const done = spawnSync(program, args, { stdio: "inherit", cwd: root, ...options });
  if (done.error || done.status !== 0) {
    throw new Error(`${title} failed${done.error ? ` (${done.error.message})` : ` (exit ${done.status})`}`);
  }
}

/** The newest makeappx.exe / signtool.exe of the Windows SDK, or null. */
function sdkTool(name) {
  const bin = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Windows Kits", "10", "bin");
  if (!existsSync(bin)) return null;
  const versions = readdirSync(bin).filter((v) => /^10\./.test(v)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return versions.map((v) => join(bin, v, "x64", name)).find((path) => existsSync(path)) ?? null;
}

/** "1.0.0" -> "1.0.0.0": an MSIX version has four numbers, and the last one must be 0 for the Store. */
function packageVersion() {
  const csproj = readFileSync(join(windows, "SevenFriends.csproj"), "utf8");
  const m = /<Version>(\d+)\.(\d+)\.(\d+)(?:\.\d+)?<\/Version>/.exec(csproj);
  if (!m) throw new Error("No <Version>x.y.z</Version> found in SevenFriends.csproj");
  return `${m[1]}.${m[2]}.${m[3]}.0`;
}

const xml = (text) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** Finds or makes the self-signed test certificate in the Current User store; returns its thumbprint (and writes the public .cer). */
function testCertificateThumbprint(subject) {
  mkdirSync(outputFolder, { recursive: true });
  const script = [
    `$subject = '${subject.replaceAll("'", "''")}'`,
    `$c = Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.Subject -eq $subject -and $_.FriendlyName -eq '${TEST_SUBJECT_NAME}' -and $_.NotAfter -gt (Get-Date).AddDays(30) } | Sort-Object NotAfter -Descending | Select-Object -First 1`,
    `if (-not $c) { $c = New-SelfSignedCertificate -Type Custom -Subject $subject -FriendlyName '${TEST_SUBJECT_NAME}' -KeyUsage DigitalSignature -KeyAlgorithm RSA -KeyLength 2048 -CertStoreLocation Cert:\\CurrentUser\\My -NotAfter (Get-Date).AddYears(2) -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}') }`,
    `Export-Certificate -Cert $c -FilePath '${testCertificate.replaceAll("'", "''")}' -Force | Out-Null`,
    `$c.Thumbprint`,
  ].join("; ");
  const done = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  if (done.error || done.status !== 0) throw new Error(`Could not make the test certificate: ${done.stderr || done.error?.message}`);
  return done.stdout.trim().split(/\r?\n/).pop().trim();
}

/**
 * Packs (and signs) the MSIX. Returns the path of the package.
 * @param {{ publish?: boolean, sign?: boolean }} options publish: run `dotnet publish` first (default true); sign: sign it (default true)
 */
export function buildMsix({ publish = true, sign = true } = {}) {
  const makeappx = sdkTool("makeappx.exe");
  const signtool = sdkTool("signtool.exe");
  if (!makeappx || (sign && !signtool)) {
    throw new Error("The Windows SDK (makeappx.exe, signtool.exe) was not found. Install the Windows 10/11 SDK (https://developer.microsoft.com/windows/downloads/windows-sdk/) and run this again.");
  }
  const env = { ...envFromFile(), ...process.env };
  const pfx = env.SF_MSIX_PFX;
  const publisher = env.SF_MSIX_PUBLISHER || "CN=Blueboot R&D AS";
  if (pfx && !env.SF_MSIX_PFX_PASSWORD) throw new Error("SF_MSIX_PFX is set but SF_MSIX_PFX_PASSWORD is not.");

  if (publish) {
    run("MSIX 1/4 Build the app", "dotnet", [
      "publish", join("client-wrappers", "windows", "SevenFriends.csproj"), "-c", "Release", "-r", "win-x64", "--self-contained", "true",
      "-p:PublishSingleFile=true", "-p:IncludeNativeLibrariesForSelfExtract=true", "-o", publishFolder,
    ]);
  }
  if (!existsSync(join(publishFolder, "SevenFriends.exe"))) throw new Error("client-wrappers/windows/publish/SevenFriends.exe is missing: run without --skip-publish.");

  console.log("\n== MSIX 2/4 Lay out the package");
  rmSync(layout, { recursive: true, force: true });
  mkdirSync(join(layout, "Assets"), { recursive: true });
  for (const name of readdirSync(publishFolder)) {
    const from = join(publishFolder, name);
    // no debug symbols and no .xml documentation files of the libraries
    if (statSync(from).isFile() && !name.endsWith(".pdb") && !name.endsWith(".xml")) copyFileSync(from, join(layout, name));
  }
  for (const name of readdirSync(join(msix, "Assets"))) copyFileSync(join(msix, "Assets", name), join(layout, "Assets", name));
  const manifest = readFileSync(join(msix, "AppxManifest.xml"), "utf8").replace("{{VERSION}}", packageVersion()).replace("{{PUBLISHER}}", xml(publisher));
  writeFileSync(join(layout, "AppxManifest.xml"), manifest);

  mkdirSync(outputFolder, { recursive: true });
  rmSync(outputFile, { force: true });
  run("MSIX 3/4 Pack", makeappx, ["pack", "/d", layout, "/p", outputFile, "/o"]);

  if (!sign) {
    console.log("\n== MSIX 4/4 Not signed (--unsigned): Windows will not install this file.");
  } else if (pfx) {
    run("MSIX 4/4 Sign (your certificate)", signtool, ["sign", "/fd", "SHA256", "/f", pfx, "/p", env.SF_MSIX_PFX_PASSWORD, outputFile]);
  } else {
    const thumbprint = testCertificateThumbprint(publisher);
    run("MSIX 4/4 Sign (self-signed TEST certificate)", signtool, ["sign", "/fd", "SHA256", "/sha1", thumbprint, "/s", "My", outputFile]);
    console.log(`Test certificate: ${testCertificate}\nTrust it (Local Machine > Trusted People) on a computer before installing the package there.`);
  }
  console.log(`\n${(statSync(outputFile).size / 1024 / 1024).toFixed(1)} MB: ${outputFile}`);
  return outputFile;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    buildMsix({ publish: !process.argv.includes("--skip-publish"), sign: !process.argv.includes("--unsigned") });
  } catch (error) {
    console.error(`\n${error.message}`);
    process.exit(1);
  }
}
