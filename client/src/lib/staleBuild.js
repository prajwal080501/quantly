// After the app is updated, a phone that still has the old page open asks for old page files that
// the new build deleted. The fix is a fresh load of the page, done once (a loop guard stops it
// from reloading forever if the file really is missing).

const KEY = 'stale-build-reload-at';
const GUARD_MS = 30_000;

export function isStaleBuildError(error) {
  const text = String(error?.message || error || '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk [\w-]+ failed/i.test(text);
}

/** Reloads the page once. Returns false (and does nothing) if it already reloaded in the last 30 s. */
export function reloadOnce({ storage = window.sessionStorage, reload = () => window.location.reload(), now = Date.now() } = {}) {
  let last = 0;
  try {
    last = Number(storage.getItem(KEY)) || 0;
  } catch {}
  if (now - last < GUARD_MS) return false;
  try {
    storage.setItem(KEY, String(now));
  } catch {}
  reload();
  return true;
}

/** Vite tells us when a page file could not be loaded; reload once instead of showing an error. */
export function watchForStaleBuild() {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnce()) event.preventDefault();
  });
}
