export type RefreshReporter = (message: string) => void

function appRootUrl(): URL {
  return new URL(import.meta.env.BASE_URL, window.location.origin)
}

export function isTrackFoodServiceWorkerScope(scope: string): boolean {
  try {
    const appRoot = appRootUrl()
    const candidate = new URL(scope)
    return candidate.origin === appRoot.origin && candidate.pathname === appRoot.pathname
  } catch {
    return false
  }
}

export function shouldClearRefreshCache(name: string): boolean {
  // Workbox is configured with cacheId="trackfood", and our explicit OCR
  // runtime cache uses the same prefix. Purge every TrackFood cache except the
  // large immutable Paddle model archives. IndexedDB is a separate store and
  // is never touched here.
  return name.startsWith("trackfood-") && !name.startsWith("trackfood-ocr-models-")
}

/**
 * Force a genuinely fresh app shell without touching TrackFood's IndexedDB.
 *
 * Normal PWA updates remain prompt-based. This escape hatch is for a phone that
 * stubbornly keeps an older installed shell: unregister this app's service
 * worker, clear TrackFood's disposable precache/runtime caches, verify the
 * current index.html over `cache: no-store`, then navigate to a cache-busted
 * URL. Foods, history, settings and the expensive OCR model cache survive.
 */
export async function forceReloadFromNetwork(report: RefreshReporter = () => undefined): Promise<void> {
  report("Stopping the installed app cache…")

  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    const ours = registrations.filter((registration) => isTrackFoodServiceWorkerScope(registration.scope))
    await Promise.all(ours.map((registration) => registration.unregister()))
  }

  if ("caches" in window) {
    const keys = await caches.keys()
    await Promise.all(keys.filter(shouldClearRefreshCache).map((key) => caches.delete(key)))
  }

  report("Fetching the newest TrackFood shell from the network…")
  const appRoot = appRootUrl()
  const probe = new URL("index.html", appRoot)
  probe.searchParams.set("__trackfood_probe", String(Date.now()))
  const response = await fetch(probe, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" }
  })
  if (!response.ok) throw new Error(`Could not fetch the newest app shell (HTTP ${response.status}).`)

  report("Fresh version found. Reloading…")
  const next = new URL(window.location.href)
  next.searchParams.set("__trackfood_refresh", String(Date.now()))
  window.location.replace(next.toString())
}
