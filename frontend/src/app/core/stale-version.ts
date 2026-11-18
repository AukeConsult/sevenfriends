/** What the browser says when a page of the app cannot be loaded because the app was updated: the open copy asks for a file the new version no longer has. */
const STALE = /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|error loading dynamically/i;

/**
 * An app that stays open for days (the Windows app, an installed web app) keeps the old version in memory. After an update the old page files are gone from the
 * server, so opening a page it has not loaded yet fails. Load the address again then: the new version is fetched and the person lands where they were going.
 * Only once a minute, so a real problem (no network) cannot make a loop of reloads.
 */
export function reloadOnStaleVersion(error: unknown, target: string | undefined): boolean {
  if (!STALE.test(String((error as { message?: unknown } | null)?.message ?? error))) return false;
  try {
    const last = Number(sessionStorage.getItem('sf-stale-reload') ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem('sf-stale-reload', String(Date.now()));
  } catch { /* no storage: reload once anyway */ }
  location.assign(target || location.href);
  return true;
}
