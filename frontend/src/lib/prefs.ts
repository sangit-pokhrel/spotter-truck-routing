/** Small per-device preferences so a driver doesn't re-enter the same load every trip. */
const PREFIX = "trip.";

export function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(PREFIX + key) ?? fallback;
  } catch {
    return fallback; // storage blocked (private mode etc.)
  }
}

export function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // ignore
  }
}
