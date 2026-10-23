/** Service worker registration + "Install app" prompt plumbing. */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let installEvent: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

export function registerServiceWorker(): void {
  // Dev uses Vite's live module graph; a caching worker there only gets in the way.
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("/sw.js");
      const reg = await navigator.serviceWorker.ready;
      // Hand the worker the hashed assets this first visit already loaded, so offline works immediately.
      const urls = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((u) => u.startsWith(location.origin) && new URL(u).pathname.startsWith("/assets/"));
      reg.active?.postMessage({ type: "cache-urls", urls });
    } catch {
      // No offline support this session; the app still works online.
    }
  });
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e as BeforeInstallPromptEvent;
  listeners.forEach((l) => l());
});

window.addEventListener("appinstalled", () => {
  installEvent = null;
  listeners.forEach((l) => l());
});

export function canInstall(): boolean {
  return installEvent !== null;
}

export function onInstallAvailabilityChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function promptInstall(): Promise<void> {
  if (!installEvent) return;
  await installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  listeners.forEach((l) => l());
}
